// Payoff math. Pure functions, no DOM, so they can be tested with `npm test`.

export const MAX_MONTHS = 600;

const monthsBetween = (from, to) => (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
export const addMonths = (d, n) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
export const startOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

export const cardId = (c) => `${c.owner}|${c.name}`;

// A card's listed minimum, or an estimate (1% of balance plus a month of interest, at least $25).
export function minimumFor(card, apr) {
  if (card.minimum > 0) return { amount: card.minimum, estimated: false };
  const est = Math.max(25, Math.round(card.balance * 0.01 + (card.balance * apr) / 12));
  return { amount: Math.min(est, card.balance), estimated: true };
}

// Splits each card into the pieces that behave differently: the part charging interest
// and the part on a 0% deal (Citi AA has both).
export function buildDebts(cards, { aprs = {}, defaultApr = 0.24 } = {}) {
  const debts = [];
  for (const c of cards) {
    if (!(c.balance > 0)) continue;
    const id = cardId(c);
    const apr = aprs[id] ?? defaultApr;
    const min = minimumFor(c, apr);
    const promoAmt = c.promo ? Math.min(c.promo.amount, c.balance) : 0;
    const base = { cardId: id, card: c.name, owner: c.owner, apr, due: c.due, note: c.note };
    if (c.balance - promoAmt > 0.005) {
      debts.push({ ...base, id: promoAmt ? `${id}|interest` : id, label: promoAmt ? `${c.name} (interest part)` : c.name, balance: c.balance - promoAmt, promoEnd: null, deferred: false, minimum: min.amount, minimumEstimated: min.estimated });
    }
    if (promoAmt > 0) {
      const onlyPromo = c.balance - promoAmt <= 0.005;
      debts.push({ ...base, id: onlyPromo ? id : `${id}|promo`, label: onlyPromo ? c.name : `${c.name} (0% part)`, balance: promoAmt, promoEnd: c.promo.end, deferred: !!c.promo.deferred, minimum: onlyPromo ? min.amount : 0, minimumEstimated: onlyPromo && min.estimated });
    }
  }
  return debts;
}

// Card companies set the minimum to at least a month's interest plus about 1% of the balance,
// so the listed minimum is a floor, not the whole story.
export function minimumDue(d, balance, interest) {
  if (balance <= 0.005) return 0;
  return Math.min(balance, Math.max(d.minimum, balance * 0.01 + interest, 25));
}

const rateOn = (d, date) => (d.promoEnd && date < new Date(d.promoEnd + 'T00:00:00Z') ? 0 : d.apr);

// What this month's minimums add up to.
export const minimumsTotal = (debts, date = startOfMonth(new Date())) =>
  debts.reduce((t, d) => {
    const interest = (d.balance * rateOn(d, date)) / 12;
    return t + minimumDue(d, d.balance + interest, interest);
  }, 0);

const promoActive = (d, date) => d.promoEnd && date < new Date(d.promoEnd + 'T00:00:00Z');

// Order for extra money. "smart": cover 0% deadlines first, then highest rate.
function priority(debts, bal, date, strategy) {
  const live = debts.map((d, i) => i).filter((i) => bal[i] > 0.005);
  const rate = (i) => (promoActive(debts[i], date) ? 0 : debts[i].apr);
  if (strategy === 'snowball') return live.sort((a, b) => bal[a] - bal[b]);
  if (strategy === 'order') return live.sort((a, b) => (rate(b) > 0) - (rate(a) > 0) || (rate(a) > 0 ? bal[a] - bal[b] : (debts[a].promoEnd || '').localeCompare(debts[b].promoEnd || '') || bal[a] - bal[b]));
  return live.sort((a, b) => rate(b) - rate(a) || bal[a] - bal[b]);
}

/**
 * Month-by-month payoff. `monthly` is the total paid toward cards each month;
 * minimums come out first, the rest goes where the strategy says.
 */
export function simulate(debts, monthly, { strategy = 'smart', start = startOfMonth(new Date()) } = {}) {
  const n = debts.length;
  const bal = debts.map((d) => d.balance);
  const deferredAccrued = debts.map(() => 0);
  const paidOffMonth = debts.map(() => null);
  const interestBy = debts.map(() => 0);
  const timeline = [{ month: 0, date: start, total: bal.reduce((a, b) => a + b, 0) }];
  let totalInterest = 0, shortfall = false, month = 0;

  while (bal.some((b) => b > 0.005) && month < MAX_MONTHS) {
    const date = addMonths(start, month);
    // Interest for the month.
    const interestNow = debts.map(() => 0);
    for (let i = 0; i < n; i++) {
      if (bal[i] <= 0.005) continue;
      const d = debts[i];
      if (promoActive(d, date)) {
        if (d.deferred) deferredAccrued[i] += (bal[i] * d.apr) / 12;
      } else {
        if (d.deferred && deferredAccrued[i] > 0) { bal[i] += deferredAccrued[i]; interestBy[i] += deferredAccrued[i]; totalInterest += deferredAccrued[i]; deferredAccrued[i] = 0; }
        const int = (bal[i] * d.apr) / 12;
        bal[i] += int; interestBy[i] += int; totalInterest += int; interestNow[i] = int;
      }
    }
    // Minimums.
    let budget = monthly;
    for (let i = 0; i < n; i++) {
      if (bal[i] <= 0.005) continue;
      const pay = minimumDue(debts[i], bal[i], interestNow[i]);
      bal[i] -= pay; budget -= pay;
    }
    if (budget < -0.005) shortfall = true;
    budget = Math.max(0, budget);
    // Smart: put enough on each 0% deal to clear it before its deadline.
    if (strategy === 'smart') {
      for (let i = 0; i < n; i++) {
        const d = debts[i];
        if (bal[i] <= 0.005 || !promoActive(d, date) || budget <= 0) continue;
        const left = Math.max(1, monthsBetween(date, new Date(d.promoEnd + 'T00:00:00Z')));
        const pay = Math.min(bal[i] / left, bal[i], budget);
        bal[i] -= pay; budget -= pay;
      }
    }
    // Everything else, in priority order (snowballs as cards are cleared).
    for (const i of priority(debts, bal, date, strategy)) {
      if (budget <= 0.005) break;
      const pay = Math.min(bal[i], budget);
      bal[i] -= pay; budget -= pay;
    }
    month++;
    for (let i = 0; i < n; i++) if (bal[i] <= 0.005 && paidOffMonth[i] === null) { bal[i] = 0; paidOffMonth[i] = month; }
    timeline.push({ month, date: addMonths(start, month), total: bal.reduce((a, b) => a + Math.max(0, b), 0) });
  }

  const done = bal.every((b) => b <= 0.005);
  return {
    months: done ? month : null,
    debtFreeDate: done ? addMonths(start, month) : null,
    totalInterest,
    interestBy,
    paidOffMonth,
    timeline,
    shortfall,
    missedDeadlines: debts.map((d, i) => (d.promoEnd && paidOffMonth[i] !== null ? addMonths(start, paidOffMonth[i]) > new Date(d.promoEnd + 'T00:00:00Z') : d.promoEnd && paidOffMonth[i] === null)).map((v) => !!v),
  };
}

// Cash left each month after everything.
export function cashFlow({ incomes, livingBills, everyday, savings, cardPayments }) {
  const income = incomes.reduce((t, x) => t + (+x || 0), 0);
  const out = livingBills + everyday + savings + cardPayments;
  return { income, out, left: income - out };
}

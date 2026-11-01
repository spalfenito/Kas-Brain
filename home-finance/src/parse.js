// Turns the raw cell grid of the budget tab into the shape the page uses.
// Only the blocks listed here are read; every other cell on the tab is ignored,
// so nothing else in the sheet (notes, IDs, personal details) leaves the Worker.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

export function money(s) {
  const m = String(s ?? '').replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  return m === '' || isNaN(+m) ? null : +m;
}

const fullYear = (y) => (y.length === 2 ? 2000 + +y : +y);
const iso = (d) => d.toISOString().slice(0, 10);

// "Citi AA- no intrest Mar 2027 on $7000" -> { base, promo: { end, amount, deferred } }
export function parseCardName(name, balance) {
  const base = name.split(/\s*-\s*no\s+int/i)[0].trim();
  const deal = (name.match(/no\s+int\w*(.*)$/i) || [])[1];
  let promo = null;
  if (deal !== undefined) {
    let end = null;
    const span = deal.match(/(\d+)\s*years?\s+starting\s+([a-z]{3})[a-z]*\.?\s*'?(\d{2,4})/i);
    const on = [...deal.matchAll(/([a-z]{3})[a-z]*\.?\s*'?(\d{2,4})\b/gi)].find((m) => m[1].toLowerCase() in MONTHS);
    if (span && span[2].toLowerCase() in MONTHS) end = new Date(Date.UTC(fullYear(span[3]) + +span[1], MONTHS[span[2].toLowerCase()], 1));
    else if (on) end = new Date(Date.UTC(fullYear(on[2]), MONTHS[on[1].toLowerCase()], 1));
    if (end) {
      const part = deal.match(/on\s*\$\s*([\d,]+)/i);
      promo = {
        end: iso(end),
        amount: Math.min(balance ?? 0, part ? +part[1].replace(/,/g, '') : balance ?? 0),
        // Store cards (Best Buy, etc.) usually charge back all interest if the deal isn't paid off in time.
        deferred: /best\s*buy|store|deferred/i.test(name),
      };
    }
  }
  return { base, promo };
}

export function parseBudget(values) {
  const grid = (values || []).map((r) => r.map((c) => String(c ?? '').trim()));
  const cell = (r, c) => (grid[r] && grid[r][c]) || '';
  const find = (re) => {
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) if (re.test(grid[r][c])) return [r, c];
    return null;
  };

  const bills = [];
  grid.forEach((row, r) => {
    if (/^\d{1,2}-[A-Za-z]{3}$/.test(cell(r, 0)) && cell(r, 1)) bills.push({ due: cell(r, 0), payee: cell(r, 1), amount: money(cell(r, 2)) ?? 0 });
  });

  const cards = [];
  grid.forEach((row, h) =>
    row.forEach((head, c) => {
      const m = head.match(/^(.+?)'s cards$/i);
      if (!m) return;
      const hasNotes = /notes/i.test(cell(h, c + 4));
      for (let r = h + 1; cell(r, c); r++) {
        const balance = money(cell(r, c + 1)) ?? 0;
        const { base, promo } = parseCardName(cell(r, c), balance);
        cards.push({ owner: m[1], name: base, label: cell(r, c), balance, due: cell(r, c + 2), minimum: money(cell(r, c + 3)), note: hasNotes ? cell(r, c + 4) : '', promo });
      }
    }),
  );
  if (!cards.length) throw new Error('No card table found on the budget tab (expected a header like "Name\'s cards").');

  const cardKeys = cards.filter((c) => c.balance > 0).map((c) => c.name.toLowerCase().split(/\s+/).slice(0, 2).join(' '));
  for (const b of bills) b.isCardPayment = cardKeys.some((k) => b.payee.toLowerCase().includes(k));

  const savings = [];
  const sv = find(/^deep savings$/i);
  if (sv) for (let r = sv[0] + 1; cell(r, sv[1] + 1) && money(cell(r, sv[1])) !== null; r++) savings.push({ account: cell(r, sv[1] + 1), amount: money(cell(r, sv[1])) });

  const cashflow = [];
  const left = find(/^what's left$/i);
  if (left) for (let r = 0; r <= left[0]; r++) if (cell(r, left[1]) && money(cell(r, left[1] - 1)) !== null) cashflow.push({ label: cell(r, left[1]), amount: money(cell(r, left[1] - 1)) });

  const income = [];
  const inc = find(/^incoming$/i);
  if (inc) for (let r = inc[0] + 1; cell(r, inc[1] - 1) && money(cell(r, inc[1])) !== null; r++) income.push({ label: cell(r, inc[1] - 1), amount: money(cell(r, inc[1])) });

  const autoCharges = [];
  const auto = find(/^auto charges on cards$/i);
  if (auto) for (let r = auto[0] + 1; r < grid.length; r++) if (cell(r, auto[1] + 1)) autoCharges.push({ name: cell(r, auto[1] + 1), amount: money(cell(r, auto[1])) });

  return { bills, cards, savings, cashflow, income, autoCharges };
}

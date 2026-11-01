import { buildDebts, simulate, minimumsTotal, cashFlow, cardId, addMonths, startOfMonth, incomeMonthly } from './finance.js';

const $ = (s) => document.querySelector(s);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdShort = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const monthYear = (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const span = (m) => {
  if (m == null) return 'never at this rate';
  const y = Math.floor(m / 12), mo = m % 12;
  return [y && `${y} yr`, mo && `${mo} mo`].filter(Boolean).join(' ') || '0 mo';
};
const dueText = (s) => String(s || '').replace(/^(\d{1,2})-([A-Za-z]{3})$/, '$2 $1').replace(/^([A-Za-z]{3})-(\d{1,2})$/, '$1 $2');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- people ---------- */
// Who's who comes from the PEOPLE secret (names stay out of the repo):
// [{"name": "...", "aliases": ["AB"], "color": "blue"}]. Without it, card owners get colors in order.
const PALETTE = { blue: '--p-blue', pink: '--p-pink', teal: '--p-teal', amber: '--p-amber', purple: '--p-purple' };
let people = [];
function setupPeople(b) {
  const list = b.people?.length ? b.people : [...new Set(b.cards.map((c) => c.owner))].map((name, i) => ({ name, color: ['blue', 'pink', 'teal', 'amber'][i % 4] }));
  people = list.map((p) => ({ ...p, aliases: [p.name, ...(p.aliases || [])].filter(Boolean).map((a) => a.toLowerCase()) }));
}
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function personOf(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const s = String(t).toLowerCase();
    const p = people.find((x) => x.aliases.some((a) => new RegExp(`(^|[^a-z])${escapeRe(a)}([^a-z]|$)`).test(s)));
    if (p) return p;
  }
  return null;
}
const personColor = (p) => (p ? (PALETTE[p.color] ? css(PALETTE[p.color]) : p.color) : css('--c-living'));
const withAlpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
function whoTag(p, text) {
  const s = document.createElement('span');
  s.className = 'who';
  s.textContent = text ?? (p ? p.name : 'Shared');
  if (p) s.style.setProperty('--who', personColor(p));
  return s;
}
function renderPeopleKey() {
  $('#people').replaceChildren(...people.map((p) => whoTag(p, [p.name, ...(p.aliases || []).filter((a) => a !== p.name.toLowerCase()).map((a) => a.toUpperCase())].join(' · '))));
}
// Money text: green when coming in or kept, red when owed or going out.
function money(elOrId, value, kind, fmt = usd.format) {
  const e = typeof elOrId === 'string' ? $(elOrId) : elOrId;
  const zero = Math.abs(value) < 0.5;
  const out = !zero && (kind === 'out' || (kind === 'auto' && value < 0));
  e.textContent = `${out ? '−' : ''}${fmt(Math.abs(value))}`;
  e.classList.toggle('neg', out);
  e.classList.toggle('pos', !out && !zero);
  return e;
}

const DEMO = new URLSearchParams(location.search).has('demo');
const STORE_KEY = 'home-finance-settings';
let budget = null;
let settings = null;
let shared = false;
const charts = {};

/* ---------- data + settings ---------- */

async function loadBudget(fresh) {
  const res = await fetch(DEMO ? 'demo-budget.json' : `/api/budget${fresh ? '?fresh=1' : ''}`, { headers: { accept: 'application/json' } });
  const body = await res.json().catch(() => ({ error: `The server answered ${res.status}` }));
  if (!res.ok || body.error) throw new Error(body.error || `The server answered ${res.status}`);
  return body;
}

function defaultsFor(b) {
  const flow = (re) => Math.abs((b.cashflow.find((x) => re.test(x.label)) || {}).amount || 0);
  const fromSheet = b.income.length ? b.income : [{ label: 'Person 1', amount: 0 }, { label: 'Person 2', amount: 0 }];
  const sources = b.incomeSources?.length ? b.incomeSources : fromSheet.map((i) => ({ key: i.label, name: i.label, amount: i.amount, period: 'month', withhold: 0 }));
  const debts = buildDebts(b.cards, { defaultApr: 0.24 });
  const plannedExtra = b.cashflow.filter((x) => /card/i.test(x.label) && x.amount < 0).reduce((t, x) => t - x.amount, 0);
  return {
    // sig remembers the starting values, so a changed secret or sheet replaces old saved numbers.
    incomes: sources.map((i) => ({ ...i, sig: JSON.stringify([i.amount, i.period, i.withhold]) })),
    everyday: flow(/^expense/i) || 1500,
    savings: flow(/^save/i),
    monthly: Math.ceil((minimumsTotal(debts) + plannedExtra) / 25) * 25,
    strategy: 'smart',
    defaultApr: 24,
    aprs: {},
  };
}

async function loadSettings(b) {
  const base = defaultsFor(b);
  let saved = null;
  if (!DEMO) {
    try {
      const r = await (await fetch('/api/settings')).json();
      shared = !!r.shared;
      saved = r.settings;
    } catch { /* offline or not set up */ }
  }
  if (!saved) { try { saved = JSON.parse(localStorage.getItem(STORE_KEY + (DEMO ? '-demo' : '')) || 'null'); } catch { saved = null; } }
  const s = { ...base, ...(saved || {}) };
  // Keep income rows in step with the sheet: new rows appear, renamed ones keep their names.
  s.incomes = base.incomes.map((row) => {
    const old = (saved?.incomes || []).find((x) => x.key === row.key && x.sig === row.sig);
    return old ? { ...row, name: old.name, amount: old.amount, period: old.period, withhold: old.withhold } : row;
  }).concat((saved?.incomes || []).filter((x) => x.custom));
  return s;
}

let saveTimer;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { savedBy, savedAt, ...clean } = settings;
    try { localStorage.setItem(STORE_KEY + (DEMO ? '-demo' : ''), JSON.stringify(clean)); } catch { /* storage blocked */ }
    if (shared && !DEMO) {
      try { await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(clean) }); $('#sync-note').textContent = 'Saved. Everyone who opens this site sees these settings.'; }
      catch { $('#sync-note').textContent = 'Could not save to the server; saved in this browser only.'; }
    }
  }, 600);
}

/* ---------- levers ---------- */

function renderIncomes() {
  const box = $('#incomes');
  box.replaceChildren();
  settings.incomes.forEach((inc, i) => {
    const row = document.createElement('div');
    row.className = 'income';
    const who = personOf(inc.owner, inc.key, inc.name);
    if (who) row.style.setProperty('--who', personColor(who));
    const top = Object.assign(document.createElement('div'), { className: 'income-top' });
    const name = Object.assign(document.createElement('input'), { className: 'name', value: inc.name, id: `inc-name-${i}`, title: 'Click to rename' });
    name.setAttribute('aria-label', 'Income name');
    const net = Object.assign(document.createElement('span'), { className: 'income-net', id: `inc-net-${i}` });
    top.append(name, net);
    if (inc.custom) {
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'icon-btn', textContent: '×', title: 'Remove this income' });
      del.setAttribute('aria-label', `Remove ${inc.name}`);
      del.addEventListener('click', () => { settings.incomes.splice(i, 1); renderIncomes(); update(); saveSettings(); });
      top.append(del);
    }
    const ctrls = Object.assign(document.createElement('div'), { className: 'income-ctrls' });
    const amt = Object.assign(document.createElement('input'), { type: 'number', min: 0, step: inc.period === 'year' ? 1000 : 50, value: inc.amount, id: `inc-amt-${i}`, inputMode: 'decimal' });
    amt.setAttribute('aria-label', `${inc.name} pay before taxes`);
    const per = document.createElement('select');
    per.id = `inc-per-${i}`;
    per.setAttribute('aria-label', 'Per');
    per.append(new Option('a year', 'year'), new Option('a month', 'month'));
    per.value = inc.period;
    const mode = document.createElement('select');
    mode.id = `inc-mode-${i}`;
    mode.setAttribute('aria-label', 'Taxes taken out');
    mode.append(new Option('Standard taxes', 'standard'), new Option('Set % taken out', 'custom'));
    mode.value = inc.withhold === 'standard' ? 'standard' : 'custom';
    const pctWrap = Object.assign(document.createElement('span'), { className: 'pct' });
    const pct = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 100, step: 0.5, value: inc.withhold === 'standard' ? 0 : inc.withhold, id: `inc-pct-${i}` });
    pct.setAttribute('aria-label', 'Percent taken out');
    pctWrap.append(pct, '%');
    pctWrap.hidden = mode.value === 'standard';
    const changed = () => { update(); saveSettings(); };
    name.addEventListener('input', () => { inc.name = name.value; saveSettings(); });
    amt.addEventListener('input', () => { inc.amount = Math.max(0, +amt.value || 0); changed(); });
    per.addEventListener('change', () => { inc.period = per.value; changed(); });
    mode.addEventListener('change', () => { inc.withhold = mode.value === 'standard' ? 'standard' : +pct.value || 0; pctWrap.hidden = mode.value === 'standard'; changed(); });
    pct.addEventListener('input', () => { inc.withhold = Math.max(0, Math.min(100, +pct.value || 0)); changed(); });
    ctrls.append(amt, per, mode, pctWrap);
    const note = Object.assign(document.createElement('p'), { className: 'hint', id: `inc-note-${i}` });
    row.append(top, ctrls, note);
    box.append(row);
  });
  const add = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn--small', textContent: '+ Add income' });
  add.addEventListener('click', () => {
    settings.incomes.push({ key: `custom-${Date.now()}`, name: 'New income', amount: 0, period: 'month', withhold: 0, custom: true });
    renderIncomes(); update(); saveSettings();
  });
  const total = document.createElement('div');
  total.className = 'income-total';
  total.innerHTML = '<span>Take-home together</span><b id="income-total"></b>';
  const gross = Object.assign(document.createElement('p'), { className: 'hint', id: 'income-gross' });
  box.append(add, total, gross);
}

function wireLevers() {
  const bind = (id, key, fmt) => {
    const input = $('#' + id);
    input.value = settings[key];
    fmt($(`#${id}-out`), settings[key]);
    input.addEventListener('input', () => { settings[key] = +input.value; fmt($(`#${id}-out`), settings[key]); schedule(); saveSettings(); });
  };
  const outflow = (e, v) => money(e, v, 'out');
  const kept = (e, v) => money(e, v, 'in');
  $('#everyday').max = Math.max(6000, Math.ceil(settings.everyday * 2 / 500) * 500);
  $('#savings').max = Math.max(4000, Math.ceil(settings.savings * 2 / 500) * 500);
  bind('everyday', 'everyday', outflow);
  bind('savings', 'savings', kept);
  bind('monthly', 'monthly', outflow);
  bind('apr', 'defaultApr', (e, v) => { e.textContent = `${(+v).toFixed(2).replace(/\.?0+$/, '')}%`; });
  for (const r of document.querySelectorAll('input[name=strategy]')) {
    r.checked = r.value === settings.strategy;
    r.addEventListener('change', () => { settings.strategy = r.value; schedule(); saveSettings(); });
  }
}

let frame;
const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };

/* ---------- charts ---------- */

function chart(id, config) {
  if (charts[id]) { charts[id].data = config.data; charts[id].options = config.options; charts[id].update('none'); return charts[id]; }
  charts[id] = new Chart(document.getElementById(id), config);
  return charts[id];
}

const baseOptions = (extra = {}) => ({
  responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: css('--panel'), titleColor: css('--muted'), bodyColor: css('--fg'), borderColor: css('--line'), borderWidth: 1, padding: 10 } },
  ...extra,
});
const axis = (extra = {}) => ({ grid: { color: css('--line') }, border: { color: css('--line') }, ...extra, ticks: { color: css('--muted'), maxTicksLimit: 6, ...(extra.ticks || {}) } });

function hbars(id, wrapId, labels, values, colors, fmt, tipExtra, dsExtra = {}) {
  const wrap = document.getElementById(wrapId);
  if (wrap) wrap.style.height = `${Math.max(120, labels.length * 30 + 40)}px`;
  chart(id, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 22, ...dsExtra }] },
    options: baseOptions({
      indexAxis: 'y',
      scales: { x: axis({ beginAtZero: true, ticks: { color: css('--muted'), maxTicksLimit: 6, callback: (v) => (fmt === usd.format || fmt === usd2.format ? usdShort.format(v) : fmt(v)) } }), y: axis({ grid: { display: false }, ticks: { autoSkip: false, maxTicksLimit: 100 } }) },
      plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => [fmt(c.raw), ...(tipExtra ? tipExtra(c.dataIndex) : [])] } } },
    }),
  });
}

/* ---------- the main update ---------- */

function update() {
  const b = budget;
  const aprs = Object.fromEntries(Object.entries(settings.aprs).map(([k, v]) => [k, v / 100]));
  const debts = buildDebts(b.cards, { aprs, defaultApr: settings.defaultApr / 100 });
  const minTotal = Math.ceil(minimumsTotal(debts));
  const totalDebt = debts.reduce((t, d) => t + d.balance, 0);
  const start = startOfMonth(new Date());

  // Payment slider can't go below the minimums.
  const slider = $('#monthly');
  slider.min = Math.ceil(minTotal / 25) * 25;
  slider.max = Math.max(+slider.min + 5000, Math.min(25000, Math.ceil(totalDebt / 6 / 500) * 500));
  if (settings.monthly < +slider.min) settings.monthly = +slider.min;
  slider.value = settings.monthly;
  money('#monthly-out', settings.monthly, 'out');
  $('#monthly-hint').textContent = `Minimums add up to ${usd.format(minTotal)}. Everything above that, ${usd.format(Math.max(0, settings.monthly - minTotal))}, is extra.`;
  $('#strategy-hint').textContent = {
    smart: 'Pays enough on each 0% deal to clear it before it ends, then puts the rest on the highest rate. Usually the cheapest.',
    avalanche: 'All extra money to the highest interest rate first. 0% deals wait, so watch the deadline warnings.',
    snowball: 'Smallest balance first for quick wins. Usually costs a bit more interest.',
  }[settings.strategy];

  const plan = simulate(debts, settings.monthly, { strategy: settings.strategy, start });
  const minOnly = simulate(debts, 0, { strategy: 'smart', start }); // only the minimum on each card, every month

  // Cash flow
  const livingBills = b.bills.filter((x) => !x.isCardPayment).reduce((t, x) => t + x.amount, 0);
  const pay = settings.incomes.map(incomeMonthly);
  settings.incomes.forEach((inc, i) => {
    const net = document.getElementById(`inc-net-${i}`), note = document.getElementById(`inc-note-${i}`);
    if (net) money(net, pay[i].net, 'in', (v) => `${usd.format(v)}/mo`);
    if (note) {
      note.replaceChildren(`${usd.format(pay[i].gross)}/mo before taxes, `, money(document.createElement('span'), pay[i].withheld, 'out'), ` taken out (${(pay[i].rate * 100).toFixed(1)}%).${inc.withhold === 0 && pay[i].gross > 0 ? ' Nothing set aside for taxes.' : ''}`);
    }
  });
  const grossTotal = pay.reduce((t, p) => t + p.gross, 0), heldTotal = pay.reduce((t, p) => t + p.withheld, 0);
  const flow = cashFlow({ incomes: pay.map((p) => p.net), livingBills, everyday: settings.everyday, savings: settings.savings, cardPayments: settings.monthly });
  money('#living-bills', livingBills, 'out');
  money('#income-total', flow.income, 'in', (v) => `${usd.format(v)}/mo`);
  $('#income-gross').textContent = `${usd.format(grossTotal * 12)} a year before taxes; ${usd.format(heldTotal)} a month taken out for taxes and insurance.`;

  // Tiles
  const interestNow = debts.filter((d) => !d.promoEnd || new Date(d.promoEnd) <= start).reduce((t, d) => t + d.balance, 0);
  $('#k-debt').textContent = usd.format(totalDebt);
  const debtNote = $('#k-debt-note');
  debtNote.replaceChildren();
  people.forEach((p, n) => {
    const owed = debts.filter((d) => personOf(d.owner) === p).reduce((t, d) => t + d.balance, 0);
    if (n) debtNote.append(' · ');
    debtNote.append(whoTag(p, `${p.name} ${usd.format(owed)}`));
  });
  $('#k-interest').textContent = usd.format(interestNow);
  money('#k-left', flow.left, 'auto');
  $('#k-left-note').textContent = flow.left < 0 ? 'More going out than coming in' : 'After bills, spending, saving and cards';
  $('#k-free').textContent = plan.debtFreeDate ? monthYear(plan.debtFreeDate) : 'Not yet';
  $('#k-free-note').textContent = plan.months != null ? `${span(plan.months)} at ${usd.format(settings.monthly)}/mo` : 'Raise the monthly payment';

  // Interest stats
  const monthlyInt = debts.reduce((t, d) => t + (d.promoEnd && new Date(d.promoEnd) > start ? 0 : (d.balance * d.apr) / 12), 0);
  money('#s-interest', plan.totalInterest, 'out');
  money('#s-saved', Math.max(0, minOnly.totalInterest - plan.totalInterest), 'in', (v) => `${usd.format(v)}${minOnly.months == null ? '+' : ''}`);
  $('#s-time').textContent = minOnly.months == null ? '50+ yr' : span(Math.max(0, minOnly.months - (plan.months ?? 0)));
  money('#s-monthly-int', monthlyInt, 'out');

  chart('c-interest', {
    type: 'bar',
    data: { labels: ['Your plan', 'Minimums only'], datasets: [{ data: [plan.totalInterest, minOnly.totalInterest], backgroundColor: [css('--accent'), css('--c-min')], borderRadius: 4, maxBarThickness: 26 }] },
    options: baseOptions({ indexAxis: 'y', scales: { x: axis({ beginAtZero: true, ticks: { color: css('--muted'), callback: (v) => usdShort.format(v) } }), y: axis({ grid: { display: false } }) },
      plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${usd.format(c.raw)} interest${c.dataIndex === 1 && minOnly.months == null ? ' over 50 years, still not paid off' : ''}` } } } }),
  });

  // Callouts
  const pc = $('#plan-callouts');
  pc.replaceChildren();
  plan.missedDeadlines.forEach((missed, i) => {
    if (!missed) return;
    const d = debts[i];
    pc.append(Object.assign(document.createElement('div'), { className: 'alert alert--warn', textContent: `${d.label} (${d.owner}) won't be paid off before its 0% deal ends in ${monthYear(new Date(d.promoEnd))}.${d.deferred ? ' Store cards often charge back all the skipped interest when that happens.' : ''} Try the Smart setting or a higher payment.` }));
  });
  if (minOnly.months == null) pc.append(Object.assign(document.createElement('div'), { className: 'alert alert--bad', textContent: 'Paying only the minimums never clears these balances at these rates.' }));

  const cc = $('#cash-callouts');
  cc.replaceChildren();
  cc.append(Object.assign(document.createElement('div'), {
    className: `alert ${flow.left < 0 ? 'alert--bad' : 'alert--good'}`,
    textContent: flow.left < 0
      ? `This plan spends ${usd.format(-flow.left)} more than you bring in each month. Lower the card payment or spending.`
      : `${usd.format(flow.left)} left over each month.${plan.months != null ? ` Once the cards are paid off in ${monthYear(plan.debtFreeDate)}, another ${usd.format(settings.monthly)} a month frees up.` : ''}`,
  }));

  const parts = [
    ['Bills', livingBills, '--c-living'], ['Everyday', settings.everyday, '--c-everyday'], ['Saving', settings.savings, '--c-saving'],
    ['Cards', settings.monthly, '--c-cards'], ['Left over', Math.max(0, flow.left), '--c-left'],
  ];
  chart('c-cash', {
    type: 'bar',
    data: { labels: ['Take-home pay'], datasets: parts.map(([label, v, c]) => ({ label, data: [v], backgroundColor: css(c), borderWidth: 0, maxBarThickness: 40 })) },
    options: baseOptions({ indexAxis: 'y',
      scales: { x: axis({ stacked: true, beginAtZero: true, max: Math.max(flow.income, flow.out), ticks: { color: css('--muted'), callback: (v) => usdShort.format(v) } }), y: axis({ stacked: true, display: false }) },
      plugins: { ...baseOptions().plugins, legend: { display: true, position: 'bottom', labels: { color: css('--fg'), boxWidth: 10, boxHeight: 10 } },
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { title: () => '', label: (c) => `${c.dataset.label}: ${usd.format(c.raw)}${flow.income ? ` (${Math.round((c.raw / flow.income) * 100)}%)` : ''}` } } } }),
  });

  // Balance over time
  const horizon = Math.min(Math.max(plan.timeline.length, Math.min(minOnly.timeline.length, (plan.months || 60) * 2)), 240);
  const labels = Array.from({ length: horizon }, (_, i) => monthYear(addMonths(start, i)));
  const at = (sim, i) => (sim.timeline[i] ? sim.timeline[i].total : 0);
  chart('c-balance', {
    type: 'line',
    data: { labels, datasets: [
      { label: 'Your plan', data: labels.map((_, i) => at(plan, i)), borderColor: css('--accent'), backgroundColor: css('--accent-soft'), fill: true, pointRadius: 0, borderWidth: 2 },
      { label: 'Minimums only', data: labels.map((_, i) => at(minOnly, i)), borderColor: css('--c-min'), borderDash: [5, 4], pointRadius: 0, borderWidth: 2 },
    ] },
    options: baseOptions({ interaction: { mode: 'index', intersect: false },
      scales: { x: axis({ ticks: { color: css('--muted'), maxTicksLimit: 8, autoSkip: true } }), y: axis({ beginAtZero: true, ticks: { color: css('--muted'), callback: (v) => usdShort.format(v) } }) },
      plugins: { ...baseOptions().plugins, legend: { display: true, position: 'bottom', labels: { color: css('--fg'), boxWidth: 10, boxHeight: 10 } },
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => `${c.dataset.label}: ${usd.format(c.raw)}` } } } }),
  });

  // Sensitivity: months to debt-free at several payment levels
  const lo = +slider.min, step = Math.max(250, Math.round((+slider.max - lo) / 8 / 250) * 250);
  const levels = [...new Set([lo, ...Array.from({ length: 8 }, (_, i) => lo + step * (i + 1)), settings.monthly])].sort((a, b) => a - b);
  const sens = levels.map((m) => simulate(debts, m, { strategy: settings.strategy, start }));
  chart('c-sens', {
    type: 'bar',
    data: { labels: levels.map((m) => usd.format(m)), datasets: [{ data: sens.map((s) => s.months ?? 600), backgroundColor: levels.map((m) => (m === settings.monthly ? css('--accent') : css('--c-min'))), borderRadius: 4, maxBarThickness: 36 }] },
    options: baseOptions({ scales: { x: axis({ grid: { display: false }, ticks: { maxTicksLimit: 12 }, title: { display: true, text: 'Paid toward cards each month', color: css('--muted') } }), y: axis({ beginAtZero: true, title: { display: true, text: 'Months', color: css('--muted') } }) },
      plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => [sens[c.dataIndex].months == null ? 'Not paid off in 50 years' : `Debt-free in ${span(sens[c.dataIndex].months)}`, `Interest: ${usd.format(sens[c.dataIndex].totalInterest)}`] } } } }),
  });

  // Payoff plan chart + table
  const order = debts.map((d, i) => i).sort((a, b) => (plan.paidOffMonth[a] ?? 9e9) - (plan.paidOffMonth[b] ?? 9e9) || debts[a].balance - debts[b].balance);
  const isPromo = (d) => d.promoEnd && new Date(d.promoEnd) > start;
  hbars('c-payoff', 'payoff-wrap',
    order.map((i, n) => `${n + 1}. ${debts[i].label} · ${debts[i].owner}`),
    order.map((i) => plan.paidOffMonth[i] ?? 600),
    order.map((i) => (isPromo(debts[i]) ? withAlpha(personColor(personOf(debts[i].owner)), 0.38) : personColor(personOf(debts[i].owner)))),
    (v) => `${v} mo`,
    (k) => { const i = order[k]; return [isPromo(debts[i]) ? `0% until ${monthYear(new Date(debts[i].promoEnd))}` : 'Charging interest', plan.paidOffMonth[i] ? `Paid off ${monthYear(addMonths(start, plan.paidOffMonth[i]))}` : 'Not paid off in 50 years', `Balance now ${usd2.format(debts[i].balance)}`, `Interest ${usd.format(plan.interestBy[i])}`]; },
    { borderColor: order.map((i) => personColor(personOf(debts[i].owner))), borderWidth: order.map((i) => (isPromo(debts[i]) ? 1.5 : 0)) });
  const legend = $('#payoff-legend');
  legend.replaceChildren(...people.map((p) => whoTag(p)), Object.assign(document.createElement('span'), { textContent: 'Solid bar: charging interest · Light bar: 0% deal' }));
  charts['c-payoff'].options.scales.x.ticks.callback = (v) => `${v} mo`;
  charts['c-payoff'].update('none');

  const tbody = $('#plan-table tbody');
  const focused = document.activeElement?.dataset?.card;
  tbody.replaceChildren();
  order.forEach((i, n) => {
    const d = debts[i];
    const tr = document.createElement('tr');
    if (n === 0) tr.className = 'first';
    const td = (text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; if (text != null) c.textContent = text; tr.append(c); return c; };
    td(String(n + 1), 'num');
    td(d.label);
    td(null).append(whoTag(personOf(d.owner), d.owner));
    td(usd2.format(d.balance), 'num neg');
    const aprCell = td(null);
    const wrap = Object.assign(document.createElement('span'), { className: 'apr' });
    const input = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 60, step: 0.01, value: settings.aprs[d.cardId] ?? '', placeholder: String(settings.defaultApr), id: `apr-${n}` });
    input.dataset.card = d.cardId;
    input.setAttribute('aria-label', `${d.card} APR`);
    input.addEventListener('change', () => {
      if (input.value === '') delete settings.aprs[d.cardId]; else settings.aprs[d.cardId] = Math.max(0, +input.value);
      update(); saveSettings();
    });
    wrap.append(input, '%');
    aprCell.append(wrap);
    const status = td(null);
    const chip = document.createElement('span');
    if (isPromo(d)) { chip.className = plan.missedDeadlines[i] ? 'chip chip--warn' : 'chip chip--promo'; chip.textContent = `0% until ${monthYear(new Date(d.promoEnd))}${d.deferred ? ' (deferred)' : ''}`; }
    else { chip.className = 'chip chip--bad'; chip.textContent = 'Charging interest'; }
    status.append(chip);
    td(d.minimum ? `${d.minimumEstimated ? '~' : ''}${usd.format(d.minimum)}` : '—', 'num wide');
    td(plan.paidOffMonth[i] ? monthYear(addMonths(start, plan.paidOffMonth[i])) : 'Not in 50 yr');
    td(usd.format(plan.interestBy[i]), plan.interestBy[i] > 0.5 ? 'num neg' : 'num');
    tbody.append(tr);
    if (focused === d.cardId) input.focus();
  });
}

function renderStatic() {
  const b = budget;
  const bills = b.bills.filter((x) => x.amount > 0);
  $('#bills-note').replaceChildren(`${bills.length} bills, `, money(document.createElement('b'), bills.reduce((t, x) => t + x.amount, 0), 'out'), ' in all. Colored by whose bill it is; gray bills are shared. Card payments are covered by the card lever.');
  hbars('c-bills', 'bills-wrap', bills.map((x) => `${dueText(x.due)} · ${x.payee}`), bills.map((x) => x.amount), bills.map((x) => personColor(personOf(x.payee))), usd.format,
    (k) => [personOf(bills[k].payee)?.name || 'Shared', ...(bills[k].isCardPayment ? ['Card payment (covered by the card lever)'] : [])]);
  $('#savings-note').replaceChildren(money(document.createElement('b'), b.savings.reduce((t, x) => t + x.amount, 0), 'in'), ` across ${b.savings.length} accounts.`);
  hbars('c-savings', 'sav-wrap', b.savings.map((x) => x.account), b.savings.map((x) => x.amount), css('--c-saving'), usd.format);
  const auto = b.autoCharges.filter((x) => x.amount > 0);
  $('#auto-note').replaceChildren(money(document.createElement('b'), auto.reduce((t, x) => t + x.amount, 0), 'out', usd2.format), ' a month lands on cards from these.');
  hbars('c-auto', 'auto-wrap', auto.map((x) => x.name), auto.map((x) => x.amount), css('--c-everyday'), usd2.format);
}

function applyChartDefaults() {
  Chart.defaults.font.family = css('--font');
  Chart.defaults.color = css('--muted');
}

async function start(fresh) {
  $('#error').hidden = true;
  try {
    budget = await loadBudget(fresh);
    setupPeople(budget);
    renderPeopleKey();
    if (!settings) {
      settings = await loadSettings(budget);
      renderIncomes();
      wireLevers();
    }
    $('#status').textContent = `${DEMO ? 'Demo data. ' : ''}Read from the sheet ${new Date(budget.fetchedAt || Date.now()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.`;
    $('#sync-note').textContent = shared ? 'Settings are shared with everyone who opens this site.' : 'Settings are saved in this browser.';
    applyChartDefaults();
    renderStatic();
    update();
  } catch (err) {
    $('#status').textContent = 'Could not read the budget sheet.';
    const e = $('#error');
    e.textContent = err.message;
    e.hidden = false;
  }
}

$('#refresh').addEventListener('click', () => start(true));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (budget) { for (const k in charts) { charts[k].destroy(); delete charts[k]; } applyChartDefaults(); renderStatic(); update(); } });

// Chart.js is loaded with defer; module scripts run after it.
start(false);

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDebts, simulate, minimumsTotal, cashFlow } from '../public/finance.js';

const start = new Date(Date.UTC(2026, 10, 1));
// Made-up example cards (no real data in the repo).
const cards = [
  { owner: 'A', name: 'Card One', balance: 1000, minimum: 30, promo: null },
  { owner: 'A', name: 'Card Two', balance: 5000, minimum: 100, promo: { end: '2027-03-01', amount: 2000, deferred: false } },
  { owner: 'B', name: 'Store Card', balance: 600, minimum: 25, promo: { end: '2027-11-01', amount: 600, deferred: true } },
  { owner: 'B', name: 'Paid Off', balance: 0, minimum: null, promo: null },
];

test('splits a card with a partial 0% deal into two debts', () => {
  const d = buildDebts(cards, { defaultApr: 0.24 });
  assert.equal(d.length, 4);
  assert.deepEqual(d.filter((x) => x.card === 'Card Two').map((x) => x.balance), [3000, 2000]);
});

test('paying more finishes sooner with less interest', () => {
  const d = buildDebts(cards, { defaultApr: 0.24 });
  const low = simulate(d, minimumsTotal(d) + 100, { start });
  const high = simulate(d, minimumsTotal(d) + 800, { start });
  assert.ok(high.months < low.months);
  assert.ok(high.totalInterest < low.totalInterest);
});

test('smart plan clears 0% deals before they end when it can', () => {
  const d = buildDebts(cards, { defaultApr: 0.24 });
  const r = simulate(d, 1500, { start, strategy: 'smart' });
  assert.equal(r.missedDeadlines.some(Boolean), false);
});

test('deferred interest is charged back when a store deal is missed', () => {
  const d = buildDebts([cards[2]], { defaultApr: 0.3 });
  const r = simulate(d, 25, { start });
  assert.ok(r.totalInterest > 600 * 0.3 * 0.9, `expected back-charged interest, got ${r.totalInterest}`);
  assert.equal(r.missedDeadlines[0], true);
});

test('minimums always cover the interest, so minimum-only plans still finish', () => {
  const d = buildDebts([{ owner: 'A', name: 'X', balance: 10000, minimum: 50, promo: null }], { defaultApr: 0.24 });
  assert.equal(Math.round(minimumsTotal(d, start)), 302); // 1% of 10,200 + 200 interest
  const r = simulate(d, 0, { start });
  assert.ok(r.months > 100 && r.months < 600, `took ${r.months} months`);
  assert.equal(r.shortfall, true);
});

test('cash flow', () => {
  assert.deepEqual(cashFlow({ incomes: [5000, 4000], livingBills: 3000, everyday: 1500, savings: 500, cardPayments: 2000 }), { income: 9000, out: 7000, left: 2000 });
});

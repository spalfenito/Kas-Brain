import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBudget, parseCardName } from '../src/parse.js';

const blank = () => Array(16).fill('');
const row = (cells) => Object.assign(blank(), cells);
// A made-up grid laid out like the budget tab.
const grid = [
  row({}),
  row({ 0: 'due date', 1: 'payee', 2: 'amount' }),
  row({ 0: '1-Nov', 1: 'Power', 2: '$100.00', 5: '$5,000.00', 6: 'balance' }),
  row({ 0: '2-Nov', 1: 'Card One - auto', 2: '$30.00', 4: 'incoming', 5: '-$500.00', 6: 'expense' }),
  row({ 0: '3-Nov', 1: 'Rent', 2: '$1,000.00', 3: 'AAA', 4: '$4,000' }),
  row({ 0: '4-Nov', 1: 'Phone', 2: '$50.00', 3: 'BBB', 4: '$3,000', 7: "Pat's cards", 8: 'Balance', 9: 'due date', 10: 'minimum', 11: "Sam's Cards", 12: 'Balance', 13: 'due date', 14: 'minimum', 15: 'notes' }),
  row({ 4: '$7,000', 7: 'Card One', 8: '$1,000.00', 9: 'Nov-3', 10: '$30.00', 11: "Store - no intrest 1 year starting Nov '26", 12: '$600.00', 13: 'Nov-1', 14: '$25.00', 15: 'auto pay on' }),
  row({ 5: '$2,500.00', 6: "what's left", 7: 'Card Two - no intrest Mar 2027 on $2000', 8: '$5,000.00', 9: 'Nov-9' }),
  row({ 8: '$6,000.00', 9: 'deep savings' }),
  row({ 9: '1,000.00', 10: 'ira' }),
  row({ 10: 'Secret', 11: 'do-not-read' }),
  row({ 7: 'auto charges on cards' }),
  row({ 7: '9.99', 8: 'Music' }),
];

test('reads each block and nothing else', () => {
  const b = parseBudget(grid);
  assert.deepEqual(b.bills.map((x) => [x.payee, x.amount, x.isCardPayment]), [['Power', 100, false], ['Card One - auto', 30, true], ['Rent', 1000, false], ['Phone', 50, false]]);
  assert.deepEqual(b.cards.map((c) => [c.owner, c.name, c.balance]), [['Pat', 'Card One', 1000], ['Pat', 'Card Two', 5000], ['Sam', 'Store', 600]]);
  assert.deepEqual(b.income, [{ label: 'AAA', amount: 4000 }, { label: 'BBB', amount: 3000 }]);
  assert.deepEqual(b.savings, [{ account: 'ira', amount: 1000 }]);
  assert.deepEqual(b.cashflow.map((x) => x.label), ['balance', 'expense', "what's left"]);
  assert.deepEqual(b.autoCharges, [{ name: 'Music', amount: 9.99 }]);
  assert.ok(!JSON.stringify(b).includes('do-not-read'));
});

test('reads 0% deal end dates', () => {
  assert.deepEqual(parseCardName('Card Two - no intrest Mar 2027 on $2000', 5000).promo, { end: '2027-03-01', amount: 2000, deferred: false });
  assert.equal(parseCardName('Bank - no intrest until Aug 2027', 7000).promo.end, '2027-08-01');
  assert.deepEqual(parseCardName("Best Buy - no intrest 1 year starting Nov '26", 704).promo, { end: '2027-11-01', amount: 704, deferred: true });
  assert.equal(parseCardName('Plain Card', 100).promo, null);
});

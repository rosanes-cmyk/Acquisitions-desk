'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

test('MAO = ARV x mao_percentage / 100 - repairs (6.5)', () => {
  assert.equal(C.mao_(300000, 70, 30000), 180000);
  assert.equal(C.mao_(300000, 75, 0), 225000);
  assert.equal(C.mao_(100000, 70, 100000), -30000, 'a negative MAO is real information');
});

test('the MAO percentage comes from SETTINGS and is never hard-coded at 70', () => {
  assert.notEqual(C.mao_(300000, 70, 30000), C.mao_(300000, 65, 30000));
  assert.equal(C.mao_(300000, 65, 30000), 165000);
  assert.equal(C.mao_(300000, null, 30000), null, 'no percentage means no MAO');
});

test('a blank ARV yields no MAO rather than a $0 one (3.2.5)', () => {
  assert.equal(C.mao_('', 70, 30000), null);
  assert.equal(C.mao_(null, 70, 30000), null);
  assert.equal(C.mao_(undefined, 70, 30000), null);
});

test('blank repairs count as zero repairs, which is the honest reading', () => {
  assert.equal(C.mao_(300000, 70, ''), 210000);
  assert.equal(C.mao_(300000, 70, null), 210000);
});

test('offer room = MAO - asking, or MAO when asking is blank (6.5)', () => {
  assert.equal(C.offerRoom_(180000, 150000), 30000);
  assert.equal(C.offerRoom_(180000, ''), 180000, 'no ask means all of MAO is room');
  assert.equal(C.offerRoom_(180000, null), 180000);
  assert.equal(C.offerRoom_(180000, 200000), -20000, 'asking above MAO is negative room');
  assert.equal(C.offerRoom_(null, 150000), null, 'no MAO means no room');
});

test('leadOfferRoom_ drives the card chip and the offer-room sort', () => {
  const lead = { arv: 300000, repairs: 30000, asking_price: 150000 };
  assert.equal(C.leadOfferRoom_(lead, 70), 30000);
  assert.equal(C.leadOfferRoom_({ arv: '', repairs: 10, asking_price: 5 }, 70), null,
    'leads with no ARV sort last, they do not sort as zero');
});

test('ratio_ returns null instead of 0, NaN or Infinity when the denominator is empty (6.4)', () => {
  assert.equal(C.ratio_(4, 8), 0.5);
  assert.equal(C.ratio_(0, 8), 0, 'a real zero is a real answer');
  assert.equal(C.ratio_(4, 0), null);
  assert.equal(C.ratio_(4, ''), null);
  assert.equal(C.ratio_(4, null), null);
  assert.equal(C.ratio_('', 8), null);
});

test('staleness is measured from last_touched_at in business days (6.6)', () => {
  assert.equal(C.isStale_('2026-09-01T10:00:00Z', '2026-09-11', 7), true);
  assert.equal(C.isStale_('2026-09-04T10:00:00Z', '2026-09-11', 7), true, 'exactly 7 days is stale');
  assert.equal(C.isStale_('2026-09-05T10:00:00Z', '2026-09-11', 7), false);
  assert.equal(C.isStale_('', '2026-09-11', 7), true, 'never touched is stale');
  assert.equal(C.daysUntouched_('2026-09-04T10:00:00Z', '2026-09-11'), 7);
  assert.equal(C.daysUntouched_('', '2026-09-11'), null);
});

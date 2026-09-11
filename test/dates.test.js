'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure, formatInZone } = require('./helpers/loadPure');

const C = loadPure();

test('isIsoDate_ accepts real dates and rejects impossible ones', () => {
  assert.equal(C.isIsoDate_('2026-09-11'), true);
  assert.equal(C.isIsoDate_('2024-02-29'), true, 'leap day');
  assert.equal(C.isIsoDate_('2026-02-29'), false, 'not a leap year');
  assert.equal(C.isIsoDate_('2026-02-30'), false);
  assert.equal(C.isIsoDate_('2026-13-01'), false);
  assert.equal(C.isIsoDate_('2026-9-11'), false, 'must be zero padded');
  assert.equal(C.isIsoDate_('09/11/2026'), false);
  assert.equal(C.isIsoDate_(''), false);
  assert.equal(C.isIsoDate_(null), false);
  assert.equal(C.isIsoDate_(new Date()), false, 'Date objects are never dates here');
});

test('isHhMm_ and isIsoTimestamp_', () => {
  assert.equal(C.isHhMm_('00:00'), true);
  assert.equal(C.isHhMm_('23:59'), true);
  assert.equal(C.isHhMm_('24:00'), false);
  assert.equal(C.isHhMm_('9:30'), false);
  assert.equal(C.isIsoTimestamp_('2026-09-11T18:23:15Z'), true);
  assert.equal(C.isIsoTimestamp_('2026-09-11T18:23:15.000Z'), false, 'seconds precision only');
});

test('addDays_ crosses months, years and leap days without a Date object escaping', () => {
  assert.equal(C.addDays_('2026-09-11', 1), '2026-09-12');
  assert.equal(C.addDays_('2026-09-30', 1), '2026-10-01');
  assert.equal(C.addDays_('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays_('2027-01-01', -1), '2026-12-31');
  assert.equal(C.addDays_('2024-02-28', 1), '2024-02-29');
  assert.equal(C.addDays_('2026-09-11', -30), '2026-08-12');
  assert.equal(typeof C.addDays_('2026-09-11', 5), 'string');
});

test('daysBetween_ and compareIso_', () => {
  assert.equal(C.daysBetween_('2026-09-11', '2026-09-18'), 7);
  assert.equal(C.daysBetween_('2026-09-18', '2026-09-11'), -7);
  assert.equal(C.daysBetween_('2026-09-11', '2026-09-11'), 0);
  assert.equal(C.compareIso_('2026-09-11', '2026-09-12'), -1);
  assert.equal(C.compareIso_('2026-10-01', '2026-09-30'), 1);
  assert.equal(C.compareIso_('2026-09-11', '2026-09-11'), 0);
});

test('weekday maths: 11 Sep 2026 is a Friday, and the weekend is Sat/Sun', () => {
  assert.equal(C.dayOfWeek_('2026-09-11'), 5);
  assert.equal(C.weekdayName_('2026-09-11'), 'Friday');
  assert.equal(C.isWeekend_('2026-09-11'), false);
  assert.equal(C.isWeekend_('2026-09-12'), true, 'Saturday');
  assert.equal(C.isWeekend_('2026-09-13'), true, 'Sunday');
  assert.equal(C.isWeekend_('2026-09-14'), false, 'Monday');
});

test('month windows: dayOfMonth, daysInMonth, first of month, 30-day start', () => {
  assert.equal(C.dayOfMonth_('2026-09-11'), 11);
  assert.equal(C.daysInMonth_('2026-09-11'), 30);
  assert.equal(C.daysInMonth_('2026-02-05'), 28);
  assert.equal(C.daysInMonth_('2024-02-05'), 29);
  assert.equal(C.daysInMonth_('2026-01-31'), 31);
  assert.equal(C.firstOfMonth_('2026-09-11'), '2026-09-01');
  assert.equal(C.monthWindowStart_('2026-09-11'), '2026-09-01');
  assert.equal(C.window30Start_('2026-09-11'), '2026-08-12');
});

test('isWithin_ is inclusive at both ends and rejects blanks', () => {
  assert.equal(C.isWithin_('2026-09-01', '2026-09-01', '2026-09-30'), true);
  assert.equal(C.isWithin_('2026-09-30', '2026-09-01', '2026-09-30'), true);
  assert.equal(C.isWithin_('2026-08-31', '2026-09-01', '2026-09-30'), false);
  assert.equal(C.isWithin_('2026-10-01', '2026-09-01', '2026-09-30'), false);
  assert.equal(C.isWithin_('', '2026-09-01', '2026-09-30'), false);
});

test('datePartOf_ takes the date out of a timestamp', () => {
  assert.equal(C.datePartOf_('2026-09-11T18:23:15Z'), '2026-09-11');
  assert.equal(C.datePartOf_('2026-09-11'), '2026-09-11');
  assert.equal(C.datePartOf_('not a date'), '');
  assert.equal(C.datePartOf_(''), '');
});

test('display formats used by the Today tab and the queue', () => {
  assert.equal(C.formatLongDate_('2026-09-11'), 'Friday, September 11');
  assert.equal(C.formatShortDate_('2026-09-11'), '09-11');
});

test('nowIsoUtc_ is ISO 8601 UTC to the second', () => {
  assert.equal(C.nowIsoUtc_(new Date('2026-09-11T18:23:15.456Z')), '2026-09-11T18:23:15Z');
  assert.equal(C.isIsoTimestamp_(C.nowIsoUtc_(new Date())), true);
});

// 4.8: the company decides "today", not the browser. A user in Manila and a user
// in California must land on the same business_date at the same instant.
test('businessDate_ puts CA, MX and PH on the same company day', () => {
  const tz = 'America/Los_Angeles';
  // 2026-09-12 05:00 UTC = 11 Sep 22:00 in LA, 12 Sep 13:00 in Manila.
  const instant = '2026-09-12T05:00:00Z';
  assert.equal(C.businessDate_(instant, tz, formatInZone), '2026-09-11');
  assert.equal(C.businessDate_(instant, 'Asia/Manila', formatInZone), '2026-09-12');
  assert.equal(C.businessDate_(instant, 'America/Mexico_City', formatInZone), '2026-09-11');
  // Everyone on the business timezone lands on the same company day.
  assert.equal(
    C.businessDate_(instant, tz, formatInZone),
    C.businessDate_(instant, tz, formatInZone)
  );
});

test('businessDate_ refuses to run without an adapter or with a bad one', () => {
  assert.throws(() => C.businessDate_('2026-09-11T18:00:00Z', 'UTC'), /adapter/);
  assert.throws(
    () => C.businessDate_('2026-09-11T18:00:00Z', 'UTC', () => '11/09/2026'),
    /bad date/
  );
});

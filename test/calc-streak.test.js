'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

// 2026-09-11 Fri, 09-12 Sat, 09-13 Sun, 09-14 Mon.
const EVERY_DAY = { tool_id: 'retell', cadence: 'Every day' };
const WEEKDAY = { tool_id: 'plbids', cadence: 'Every weekday' };
const WEEKLY = { tool_id: 'report', cadence: 'Weekly' };

/** Builds date -> toolId -> true from ['2026-09-11:retell', ...]. */
function done(entries) {
  const map = {};
  for (const entry of entries) {
    const [date, toolId] = entry.split(':');
    map[date] = map[date] || {};
    map[date][toolId] = true;
  }
  return map;
}

test('only Every day and Every weekday tools are daily tools (2.1)', () => {
  assert.deepEqual(C.dailyTools_([EVERY_DAY, WEEKDAY, WEEKLY]).map((t) => t.tool_id),
    ['retell', 'plbids']);
  assert.equal(C.isToolDueOn_('Every day', '2026-09-12'), true, 'every day means Saturday too');
  assert.equal(C.isToolDueOn_('Every weekday', '2026-09-11'), true);
  assert.equal(C.isToolDueOn_('Every weekday', '2026-09-12'), false, 'Saturday');
  assert.equal(C.isToolDueOn_('Every weekday', '2026-09-13'), false, 'Sunday');
  assert.equal(C.isToolDueOn_('Weekly', '2026-09-11'), false);
  assert.equal(C.isToolDueOn_('Not set', '2026-09-11'), false);
});

test('an unbroken run counts back day by day', () => {
  const runs = done(['2026-09-11:retell', '2026-09-10:retell', '2026-09-09:retell']);
  assert.equal(C.toolStreak_([EVERY_DAY], runs, '2026-09-11'), 3);
});

test('the streak stops at the first day a due tool was missed', () => {
  const runs = done(['2026-09-11:retell', '2026-09-09:retell']);
  assert.equal(C.toolStreak_([EVERY_DAY], runs, '2026-09-11'), 1, '09-10 breaks it');
});

// Finding C2 / 2.2 "must NOT port" #5: the prototype's streak died every weekend.
test('a weekend does not break a streak built on Every weekday tools (6.10)', () => {
  const runs = done([
    '2026-09-14:plbids', // Monday
    '2026-09-11:plbids', // Friday - Sat and Sun are not due days
    '2026-09-10:plbids',
    '2026-09-09:plbids'
  ]);
  assert.equal(C.toolStreak_([WEEKDAY], runs, '2026-09-14'), 6,
    'Mon + Sun + Sat + Fri + Thu + Wed');
});

test('an Every day tool DOES have to run at the weekend', () => {
  const runs = done(['2026-09-14:retell', '2026-09-11:retell']);
  assert.equal(C.toolStreak_([EVERY_DAY], runs, '2026-09-14'), 1, 'Saturday was missed');
});

test('every daily tool due that day must be done, not just one of them', () => {
  const runs = done([
    '2026-09-11:retell', '2026-09-11:plbids',
    '2026-09-10:retell' // plbids missed on the Thursday
  ]);
  assert.equal(C.toolStreak_([EVERY_DAY, WEEKDAY], runs, '2026-09-11'), 1);
});

test('a weekly tool never blocks the streak', () => {
  const runs = done(['2026-09-11:retell', '2026-09-10:retell']);
  assert.equal(C.toolStreak_([EVERY_DAY, WEEKLY], runs, '2026-09-11'), 2);
});

test('no daily tools means no streak, rather than a vacuous 60', () => {
  assert.equal(C.toolStreak_([], {}, '2026-09-11'), 0);
  assert.equal(C.toolStreak_([WEEKLY], {}, '2026-09-11'), 0);
});

test('nothing done today means no streak', () => {
  assert.equal(C.toolStreak_([EVERY_DAY], {}, '2026-09-11'), 0);
});

test('the streak never counts back further than the cap (6.10)', () => {
  const runs = {};
  for (let i = 0; i < 400; i++) {
    runs[C.addDays_('2026-09-11', -i)] = { retell: true };
  }
  assert.equal(C.toolStreak_([EVERY_DAY], runs, '2026-09-11'), 60, 'default cap');
  assert.equal(C.toolStreak_([EVERY_DAY], runs, '2026-09-11', 10), 10);
});

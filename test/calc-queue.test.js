'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();
const TODAY = '2026-09-11';

function lead(id, fields) {
  return Object.assign({ lead_id: id, status: 'NEW', next_action: 'Call back', due_date: '' }, fields);
}

test('the queue splits into the five Today sections (5.8)', () => {
  const leads = [
    lead('overdue', { due_date: '2026-09-09' }),
    lead('today', { due_date: TODAY }),
    lead('soon', { due_date: '2026-09-14' }),
    lead('noAction', { next_action: '' }),
    lead('noDue', { due_date: '' })
  ];
  const queue = C.classifyQueue_(leads, TODAY);
  assert.deepEqual(queue.overdue.map((l) => l.lead_id), ['overdue']);
  assert.deepEqual(queue.dueToday.map((l) => l.lead_id), ['today']);
  assert.deepEqual(queue.upcoming.map((l) => l.lead_id), ['soon']);
  assert.deepEqual(queue.noNextAction.map((l) => l.lead_id), ['noAction']);
  assert.deepEqual(queue.noDueDate.map((l) => l.lead_id), ['noDue']);
});

test('upcoming is the next 7 days, and day 8 is in no section', () => {
  const leads = [
    lead('day1', { due_date: '2026-09-12' }),
    lead('day7', { due_date: '2026-09-18' }),
    lead('day8', { due_date: '2026-09-19' })
  ];
  const queue = C.classifyQueue_(leads, TODAY);
  assert.deepEqual(queue.upcoming.map((l) => l.lead_id), ['day1', 'day7']);
  const everywhere = []
    .concat(queue.overdue, queue.dueToday, queue.upcoming, queue.noNextAction, queue.noDueDate)
    .map((l) => l.lead_id);
  assert.equal(everywhere.includes('day8'), false, 'a lead scheduled next month is not a warning');
});

test('sections are mutually exclusive, in the documented priority order', () => {
  const leads = [lead('urgentNoAction', { due_date: '2026-09-01', next_action: '' })];
  const queue = C.classifyQueue_(leads, TODAY);
  assert.deepEqual(queue.overdue.map((l) => l.lead_id), ['urgentNoAction']);
  assert.equal(queue.noNextAction.length, 0, 'it is chased once, as overdue');
});

test('a lead with neither a next action nor a due date is a No-next-action warning', () => {
  const queue = C.classifyQueue_([lead('bare', { next_action: '', due_date: '' })], TODAY);
  assert.deepEqual(queue.noNextAction.map((l) => l.lead_id), ['bare']);
  assert.equal(queue.noDueDate.length, 0);
});

test('only live leads reach the queue - closed and archived ones do not', () => {
  const leads = [
    lead('live', { status: 'UNDER_CONTRACT', due_date: '2026-09-01' }),
    lead('closed', { status: 'CLOSED', due_date: '2026-09-01' }),
    lead('archived', { status: 'ARCHIVED_SOLD', due_date: '2026-09-01' }),
    lead('badData', { status: 'ARCHIVED_BAD_DATA', next_action: '' })
  ];
  const queue = C.classifyQueue_(leads, TODAY);
  assert.deepEqual(queue.overdue.map((l) => l.lead_id), ['live']);
  assert.equal(queue.noNextAction.length, 0);
});

test('overdue leads are listed oldest first, so the worst is at the top', () => {
  const leads = [
    lead('a', { due_date: '2026-09-09' }),
    lead('b', { due_date: '2026-08-01' }),
    lead('c', { due_date: '2026-09-10' })
  ];
  assert.deepEqual(C.classifyQueue_(leads, TODAY).overdue.map((l) => l.lead_id), ['b', 'a', 'c']);
});

test('a malformed due date is treated as no due date, never as overdue', () => {
  const queue = C.classifyQueue_([lead('junk', { due_date: 'next tuesday' })], TODAY);
  assert.equal(queue.overdue.length, 0);
  assert.deepEqual(queue.noDueDate.map((l) => l.lead_id), ['junk']);
});

test('an empty board produces five empty sections, not an error', () => {
  const queue = C.classifyQueue_([], TODAY);
  assert.deepEqual(queue, { overdue: [], dueToday: [], upcoming: [], noNextAction: [], noDueDate: [] });
});

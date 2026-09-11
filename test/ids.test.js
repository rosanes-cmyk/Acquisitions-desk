'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure, sequenceRandom } = require('./helpers/loadPure');

const C = loadPure();

test('lead ids are LEAD-yyyyMMdd-XXXXX from the A-Z2-9 alphabet', () => {
  const id = C.newLeadId_('2026-09-11', null, sequenceRandom([0]));
  assert.equal(id, 'LEAD-20260911-AAAAA');
  assert.match(C.newLeadId_('2026-09-11'), /^LEAD-20260911-[A-Z2-9]{5}$/);
});

test('the id alphabet is exactly A-Z2-9 (3.2.7)', () => {
  assert.equal(C.ID_ALPHABET_, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789');
  assert.equal(C.ID_ALPHABET_.length, 34, '26 letters + 8 digits');
  for (const banned of ['0', '1']) {
    assert.equal(C.ID_ALPHABET_.includes(banned), false, `${banned} is not in A-Z2-9`);
  }
});

test('a collision is retried until the id is free (3.2.7)', () => {
  const taken = new Set(['LEAD-20260911-AAAAA', 'LEAD-20260911-BBBBB']);
  // Random returns 0 (A) twice, then a value that lands on B, then C.
  const random = sequenceRandom([0, 0, 0, 0, 0, 1 / 34, 1 / 34, 1 / 34, 1 / 34, 1 / 34,
    2 / 34, 2 / 34, 2 / 34, 2 / 34, 2 / 34]);
  const id = C.newLeadId_('2026-09-11', (candidate) => taken.has(candidate), random);
  assert.equal(id, 'LEAD-20260911-CCCCC');
});

test('generation gives up rather than looping forever', () => {
  assert.throws(
    () => C.newLeadId_('2026-09-11', () => true),
    /Could not generate a unique LEAD id/
  );
});

test('every entity prefix builds a well-formed id', () => {
  const cases = [
    ['ACT', C.ID_PREFIX_.ACTIVITY], ['APPT', C.ID_PREFIX_.APPOINTMENT],
    ['RUN', C.ID_PREFIX_.RUN], ['USR', C.ID_PREFIX_.USER], ['TOOL', C.ID_PREFIX_.TOOL],
    ['EVT', C.ID_PREFIX_.EVENT], ['ERR', C.ID_PREFIX_.ERROR], ['BKP', C.ID_PREFIX_.BACKUP],
    ['TRN', C.ID_PREFIX_.TRAINING]
  ];
  for (const [expected, prefix] of cases) {
    assert.equal(prefix, expected);
    const id = C.newUniqueId_(prefix, C.compactStamp_('2026-09-11T18:23:15Z'));
    assert.equal(C.isValidIdFormat_(prefix, id), true, `${id} should be a valid ${prefix} id`);
  }
});

test('compact stamps strip punctuation and stop at seconds', () => {
  assert.equal(C.compactDate_('2026-09-11'), '20260911');
  assert.equal(C.compactStamp_('2026-09-11T18:23:15Z'), '20260911182315');
});

test('isValidIdFormat_ rejects near misses', () => {
  assert.equal(C.isValidIdFormat_('LEAD', 'LEAD-20260911-ABCDE'), true);
  assert.equal(C.isValidIdFormat_('LEAD', 'LEAD-20260911-ABCD'), false, 'too short');
  assert.equal(C.isValidIdFormat_('LEAD', 'LEAD-20260911-ABCD0'), false, '0 is not in the alphabet');
  assert.equal(C.isValidIdFormat_('LEAD', 'lead-20260911-ABCDE'), false, 'case matters');
  assert.equal(C.isValidIdFormat_('LEAD', '12'), false, 'a row number is never an id');
  assert.equal(C.isValidIdFormat_('LEAD', 12), false);
});

test('tool ids accept generated ids and the 22 prototype seed slugs', () => {
  assert.equal(C.isValidToolId_('retell'), true);
  assert.equal(C.isValidToolId_('agentdesk'), true);
  assert.equal(C.isValidToolId_('TOOL-20260911-ABCDE'), true);
  assert.equal(C.isValidToolId_('Has Spaces'), false);
  assert.equal(C.isValidToolId_(''), false);
});

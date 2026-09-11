'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

test('the success envelope has the shape every client handler expects (4.4)', () => {
  const envelope = C.okEnvelope_({ lead_id: 'L1' }, {
    changeStamp: '42', serverTimeUtc: '2026-09-11T18:23:15Z'
  });
  assert.deepEqual(envelope, {
    ok: true,
    data: { lead_id: 'L1' },
    changeStamp: '42',
    serverTimeUtc: '2026-09-11T18:23:15Z'
  });
  assert.equal('message' in envelope, false, 'message is only present when there is one');
});

test('an optional message rides along', () => {
  const envelope = C.okEnvelope_(null, { message: 'Saved by Juan' });
  assert.equal(envelope.message, 'Saved by Juan');
  assert.equal(envelope.data, null);
});

test('undefined data becomes null so the client never sees a missing key', () => {
  const envelope = C.okEnvelope_(undefined, {});
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data, null);
  assert.equal(envelope.changeStamp, '');
  assert.equal(envelope.serverTimeUtc, '');
});

test('the error envelope carries one of the eight pinned codes (4.4)', () => {
  assert.deepEqual(C.ERROR_CODES_, ['IDENTITY_UNAVAILABLE', 'ACCESS_DENIED', 'VALIDATION_ERROR',
    'NOT_FOUND', 'CONFLICT_RECORD_CHANGED', 'LOCK_TIMEOUT', 'DUPLICATE', 'SERVER_ERROR']);
  const envelope = C.errEnvelope_('NOT_FOUND', 'No such lead.');
  assert.deepEqual(envelope, { ok: false, code: 'NOT_FOUND', message: 'No such lead.' });
});

test('a conflict carries the latest record so the client can show it (4.5)', () => {
  const latest = { lead_id: 'L1', version: 11 };
  const envelope = C.errEnvelope_('CONFLICT_RECORD_CHANGED', C.CONFLICT_MESSAGE_, latest);
  assert.equal(envelope.code, 'CONFLICT_RECORD_CHANGED');
  assert.deepEqual(envelope.data, latest);
  assert.equal(
    envelope.message,
    'This lead was updated by another team member. Review the latest information before saving your change.'
  );
});

test('an unrecognized code degrades to SERVER_ERROR rather than leaking an internal one', () => {
  assert.equal(C.errEnvelope_('KABOOM', 'x').code, 'SERVER_ERROR');
  assert.equal(C.errEnvelope_(undefined, 'x').code, 'SERVER_ERROR');
});

test('an error always has a message, even when the caller forgot one', () => {
  assert.equal(C.errEnvelope_('SERVER_ERROR').message, 'Something went wrong.');
  assert.equal('data' in C.errEnvelope_('SERVER_ERROR', 'x'), false);
  assert.equal('data' in C.errEnvelope_('SERVER_ERROR', 'x', null), false);
});

test('validation errors name their field so the client can mark the control (4.6)', () => {
  const err = C.validationError_('due_date', 'due_date must be a real date as yyyy-MM-dd.');
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.equal(err.field, 'due_date');
  assert.equal(C.isValidationError_(err), true);
  assert.equal(C.isValidationError_(new Error('boom')), false);
  assert.equal(C.isValidationError_(null), false);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

const EXISTING = [
  {
    lead_id: 'LEAD-20260901-AAAAA', address: '123 Main Street', phone: '510-555-0134',
    address_normalized: '123 MAIN ST', phone_normalized: '5105550134', status: 'NEW'
  },
  {
    lead_id: 'LEAD-20260901-BBBBB', address: '45 Oak Ave', phone: '',
    address_normalized: '45 OAK AVE', phone_normalized: '', status: 'CLOSED'
  }
];

test('the same address in a different spelling is an exact duplicate (6.7)', () => {
  const result = C.classifyDuplicate_({ address: '123 main st.', phone: '' }, EXISTING);
  assert.deepEqual(result, { kind: 'EXACT', leadId: 'LEAD-20260901-AAAAA' });
});

test('an exact duplicate is found regardless of the existing lead status', () => {
  assert.equal(C.classifyDuplicate_({ address: '45 OAK AVENUE' }, EXISTING).kind, 'EXACT',
    'a closed lead is still the same property');
});

test('the same phone at a DIFFERENT address is only a possible duplicate (6.7)', () => {
  const result = C.classifyDuplicate_(
    { address: '999 New Road', phone: '(510) 555-0134' }, EXISTING
  );
  assert.deepEqual(result, { kind: 'POSSIBLE', leadId: 'LEAD-20260901-AAAAA' });
});

test('a new property with a new phone is not a duplicate', () => {
  assert.deepEqual(C.classifyDuplicate_({ address: '999 New Rd', phone: '510-555-7777' }, EXISTING),
    { kind: 'NONE', leadId: '' });
});

test('an address match beats a phone match - the property is the identity', () => {
  const result = C.classifyDuplicate_(
    { address: '123 Main St', phone: '510-555-0134' }, EXISTING
  );
  assert.equal(result.kind, 'EXACT');
});

// 6.7: bad-data rows are excluded so a typo cannot permanently block a real address.
test('leads archived as bad data are ignored by both checks', () => {
  const withBadData = [{
    lead_id: 'LEAD-20260901-CCCCC', address: '77 Typo St', phone: '5105550134',
    address_normalized: '77 TYPO ST', phone_normalized: '5105550134',
    status: 'ARCHIVED_BAD_DATA'
  }];
  assert.equal(C.classifyDuplicate_({ address: '77 Typo Street' }, withBadData).kind, 'NONE');
  assert.equal(
    C.classifyDuplicate_({ address: '88 Other St', phone: '5105550134' }, withBadData).kind,
    'NONE'
  );
});

test('a blank phone never matches another blank phone', () => {
  assert.equal(C.classifyDuplicate_({ address: '999 New Rd', phone: '' }, EXISTING).kind, 'NONE');
});

test('classification works against raw rows that were never normalized', () => {
  const raw = [{ lead_id: 'L1', address: '123 Main Street', phone: '510-555-0134', status: 'NEW' }];
  assert.equal(C.classifyDuplicate_({ address: '123 MAIN ST' }, raw).kind, 'EXACT');
  assert.equal(C.classifyDuplicate_({ address: '5 Other St', phone: '5105550134' }, raw).kind,
    'POSSIBLE');
});

test('an empty board has no duplicates', () => {
  assert.deepEqual(C.classifyDuplicate_({ address: '1 A St', phone: '555' }, []),
    { kind: 'NONE', leadId: '' });
});

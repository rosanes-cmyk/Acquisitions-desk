'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

test('the prototype enumerations are preserved verbatim, with their counts (2.1)', () => {
  assert.equal(C.APPOINTMENT_OUTCOMES_.length, 7);
  assert.deepEqual(C.APPOINTMENT_OUTCOMES_, ['', 'Not visited yet', 'Offer made',
    'Thinking about it', 'Too high on price', 'No deal', 'Signed']);
  assert.equal(C.TOOL_STATUSES_.length, 6);
  assert.equal(C.TOOL_RECOMMENDATIONS_.length, 5);
  assert.equal(C.CADENCES_.length, 6);
  assert.equal(C.VERDICTS_.length, 4);
  assert.equal(C.PILLAR_STATES_.length, 4);
  assert.equal(C.CHANNELS_.length, 4);
  assert.deepEqual(C.DAILY_CADENCES_, ['Every day', 'Every weekday']);
  assert.deepEqual(C.ROLES_, ['ADMIN', 'MANAGER', 'REP', 'TECHNICAL']);
});

test('LIVE is the first five statuses; CLOSED is neither live nor archived (2.1)', () => {
  assert.equal(C.LIVE_STATUSES_.length, 5);
  assert.equal(C.ALL_STATUSES_.length, 10);
  assert.equal(C.isLiveStatus_('UNDER_CONTRACT'), true);
  assert.equal(C.isLiveStatus_('CLOSED'), false);
  assert.equal(C.isArchivedStatus_('CLOSED'), false);
  assert.equal(C.isArchivedStatus_('ARCHIVED_SOLD'), true);
  assert.equal(C.STATUS_LABELS_.ARCHIVED_NO_EQUITY, 'Archived: no equity');
  assert.equal(C.ARCHIVE_REASONS_.ARCHIVED_NOT_INTERESTED, 'not interested');
});

test('blank is not zero (3.2.5)', () => {
  assert.equal(C.toNumberOrNull_(''), null);
  assert.equal(C.toNumberOrNull_(null), null);
  assert.equal(C.toNumberOrNull_(undefined), null);
  assert.equal(C.toNumberOrNull_('   '), null);
  assert.equal(C.toNumberOrNull_(0), 0);
  assert.equal(C.toNumberOrNull_('0'), 0);
  assert.equal(C.toNumberOrNull_('$1,250'), 1250);
  assert.equal(C.toNumberOrNull_('abc'), null);
});

test('toBool_ normalizes everything Sheets can hand back (3.2.4)', () => {
  for (const truthy of [true, 'TRUE', 'true', 'True', 1, '1', 'yes']) {
    assert.equal(C.toBool_(truthy), true, `${truthy} should read as true`);
  }
  for (const falsy of [false, 'FALSE', 'false', 0, '0', '', null, undefined]) {
    assert.equal(C.toBool_(falsy), false, `${falsy} should read as false`);
  }
});

test('requireEnum_ names the field it rejected', () => {
  assert.equal(C.requireEnum_('status', 'NEW', C.ALL_STATUSES_), 'NEW');
  assert.throws(() => C.requireEnum_('status', 'Brand New', C.ALL_STATUSES_), (err) => {
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.field, 'status');
    assert.match(err.message, /status/);
    return true;
  });
});

test('date, time, number and boolean validators', () => {
  assert.equal(C.requireIsoDate_('due_date', '2026-09-11'), '2026-09-11');
  assert.equal(C.requireIsoDate_('due_date', '', true), '', 'optional blank is allowed');
  assert.throws(() => C.requireIsoDate_('due_date', ''), /required/);
  assert.throws(() => C.requireIsoDate_('due_date', '09/11/2026'), /yyyy-MM-dd/);
  assert.equal(C.requireHhMm_('appointment_time', '14:30'), '14:30');
  assert.throws(() => C.requireHhMm_('appointment_time', '2:30pm'), /HH:mm/);
  assert.equal(C.requireNonNegativeNumberOrBlank_('arv', ''), null, 'blank stays blank');
  assert.equal(C.requireNonNegativeNumberOrBlank_('arv', '250000'), 250000);
  assert.throws(() => C.requireNonNegativeNumberOrBlank_('arv', -5), /cannot be negative/);
  assert.throws(() => C.requireNonNegativeNumberOrBlank_('arv', 'lots'), /must be a number/);
  assert.throws(() => C.requireBoolean_('flag_juan', 'true'), /must be true or false/);
  assert.equal(C.requireBoolean_('flag_juan', true), true);
});

test('requireText_ trims, collapses and enforces the pinned max lengths (4.6)', () => {
  assert.equal(C.requireText_('address', '  123   Main  St '), '123 Main St');
  assert.throws(() => C.requireText_('address', ''.padEnd(201, 'x')), /longer than 200/);
  assert.throws(() => C.requireText_('next_action', ''.padEnd(301, 'x')), /longer than 300/);
  assert.throws(() => C.requireText_('address', '   ', { required: true }), /required/);
});

// 2.2 "must NOT port" #6 / finding C7: the prototype accepted any string here.
test('tool links are http(s) only - javascript: is rejected', () => {
  assert.deepEqual(C.validateHttpLink_('https://example.com/tool'), {
    ok: true, value: 'https://example.com/tool'
  });
  assert.equal(C.validateHttpLink_('').ok, true, 'blank is fine');
  assert.equal(C.validateHttpLink_('javascript:alert(1)').ok, false);
  assert.equal(C.validateHttpLink_('JavaScript:alert(1)').ok, false);
  assert.equal(C.validateHttpLink_('data:text/html,<script>').ok, false);
  assert.equal(C.validateHttpLink_('example.com').ok, false, 'needs a scheme');
  assert.equal(C.validateHttpLink_('ftp://example.com').ok, false);
  assert.throws(() => C.requireHttpLink_('link', 'javascript:alert(1)'), /http:\/\/ or https:\/\//);
});

test('pickWhitelisted_ separates allowed, routed-elsewhere and unknown fields (4.6)', () => {
  const result = C.pickWhitelisted_(
    { status: 'NEW', arv: 100, assigned_to: 'USR-1', version: 9, nonsense: true },
    C.UPDATE_LEAD_FIELDS_
  );
  assert.deepEqual(result.clean, { status: 'NEW', arv: 100 });
  assert.deepEqual(result.routed, ['assigned_to'], 'assigned_to belongs to assignLead');
  assert.deepEqual(result.rejected.sort(), ['nonsense', 'version']);
});

test('one route per field: updateLead never owns the dedicated-action fields (4.6)', () => {
  assert.equal(C.routeForField_('assigned_to'), 'assignLead');
  assert.equal(C.routeForField_('next_action'), 'setNextAction');
  assert.equal(C.routeForField_('due_date'), 'setNextAction');
  assert.equal(C.routeForField_('flag_juan'), 'setJuanFlag');
  assert.equal(C.routeForField_('compliance_mailer_check'), 'setComplianceFlag');
  assert.equal(C.routeForField_('contact_attempts'), 'logAttempt');
  assert.equal(C.routeForField_('status'), '', 'status IS updateLead territory');
  for (const field of ['assigned_to', 'next_action', 'due_date', 'contact_attempts']) {
    assert.equal(C.UPDATE_LEAD_FIELDS_.includes(field), false, `${field} must not be in updateLead`);
  }
});

test('status transitions (4.6)', () => {
  // live <-> live
  assert.equal(C.canTransitionStatus_('NEW', 'CONTACT_MADE', 'updateLead'), true);
  assert.equal(C.canTransitionStatus_('UNDER_CONTRACT', 'NEW', 'updateLead'), true);
  // live -> CLOSED
  assert.equal(C.canTransitionStatus_('UNDER_CONTRACT', 'CLOSED', 'updateLead'), true);
  assert.equal(C.canTransitionStatus_('NEW', 'CLOSED', 'updateLead'), true);
  // updateLead may never archive or restore
  assert.equal(C.canTransitionStatus_('NEW', 'ARCHIVED_SOLD', 'updateLead'), false);
  assert.equal(C.canTransitionStatus_('ARCHIVED_SOLD', 'NEW', 'updateLead'), false);
  // archiveLead: live or CLOSED -> ARCHIVED_*
  assert.equal(C.canTransitionStatus_('NEW', 'ARCHIVED_BAD_DATA', 'archiveLead'), true);
  assert.equal(C.canTransitionStatus_('CLOSED', 'ARCHIVED_SOLD', 'archiveLead'), true);
  assert.equal(C.canTransitionStatus_('ARCHIVED_SOLD', 'ARCHIVED_BAD_DATA', 'archiveLead'), false);
  assert.equal(C.canTransitionStatus_('NEW', 'CLOSED', 'archiveLead'), false);
  // restoreLead: ARCHIVED_* -> live only
  assert.equal(C.canTransitionStatus_('ARCHIVED_NO_EQUITY', 'INVESTIGATING', 'restoreLead'), true);
  assert.equal(C.canTransitionStatus_('ARCHIVED_NO_EQUITY', 'CLOSED', 'restoreLead'), false);
  assert.equal(C.canTransitionStatus_('NEW', 'INVESTIGATING', 'restoreLead'), false);
  // unknown target
  assert.equal(C.canTransitionStatus_('NEW', 'PENDING', 'updateLead'), false);
});

test('server-owned fields are listed so no action can accept them (4.6)', () => {
  for (const field of ['lead_id', 'version', 'created_at', 'updated_by', 'recent_notes_json',
    'archive_reason', 'address_normalized', 'phone_normalized', 'last_touched_at']) {
    assert.equal(C.SERVER_OWNED_FIELDS_.includes(field), true, `${field} must be server-owned`);
    assert.equal(C.UPDATE_LEAD_FIELDS_.includes(field), false, `${field} must not be patchable`);
  }
});

test('address normalization collapses the spellings that hide duplicates (6.7)', () => {
  assert.equal(C.normalizeAddress_('123 Main Street'), '123 MAIN ST');
  assert.equal(C.normalizeAddress_('123 main st.'), '123 MAIN ST');
  assert.equal(C.normalizeAddress_('  123   N. Main  Street , Apt 2 '), '123 N MAIN ST APT 2');
  assert.equal(C.normalizeAddress_('45 Oak Avenue'), '45 OAK AVE');
  assert.equal(C.normalizeAddress_('45 Oak Ave'), '45 OAK AVE');
  assert.equal(C.normalizeAddress_('9 Elm Boulevard'), '9 ELM BLVD');
  assert.equal(C.normalizeAddress_('7 Pine Court'), '7 PINE CT');
  assert.equal(C.normalizeAddress_('7 Pine Drive'), '7 PINE DR');
  assert.equal(C.normalizeAddress_('7 Pine Lane'), '7 PINE LN');
  assert.equal(C.normalizeAddress_('7 Pine Road'), '7 PINE RD');
  assert.equal(C.normalizeAddress_(''), '');
});

test('phone normalization keeps the last 10 digits (6.7)', () => {
  assert.equal(C.normalizePhone_('+1 (510) 555-0134'), '5105550134');
  assert.equal(C.normalizePhone_('5105550134'), '5105550134');
  // 'last 10 digits' is the pinned rule (6.7); an extension shifts the window,
  // which is why an extension typed into the phone field is worth avoiding.
  assert.equal(C.normalizePhone_('510.555.0134 ext 2'), '1055501342');
  assert.equal(C.normalizePhone_('555-0134'), '5550134', 'short numbers are kept as-is');
  assert.equal(C.normalizePhone_(''), '');
  assert.equal(C.normalizeEmail_('  Juan@TwinHomeBuyer.com '), 'juan@twinhomebuyer.com');
});

test('a rejected field explains WHY it was rejected (4.6)', () => {
  assert.match(C.rejectionReason_('version'), /maintained by the server/);
  assert.match(C.rejectionReason_('recent_notes_json'), /maintained by the server/);
  assert.match(C.rejectionReason_('nonsense'), /no field called nonsense/);
});

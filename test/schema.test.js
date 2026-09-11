'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure, PURE_FILES } = require('./helpers/loadPure');

// Setup.js touches SpreadsheetApp only inside function bodies, so loading it
// defines SCHEMA_ without calling anything. That makes the schema itself testable.
const C = loadPure([...PURE_FILES, 'Setup.js']);

const EXPECTED_SHEETS = ['USERS', 'LEADS', 'LEAD_ACTIVITY', 'APPOINTMENTS', 'DAILY_METRICS',
  'TOOL_INVENTORY', 'TOOL_TRAINING', 'TOOL_RUNS', 'PILLARS', 'BUILDER_ROLLCALL', 'SETTINGS',
  'AUDIT_LOG', 'ERROR_LOG', 'BACKUP_LOG', 'TEST_RESULTS'];

test('every sheet in 3.3 is declared, and nothing extra', () => {
  assert.deepEqual(Object.keys(C.SCHEMA_).sort(), [...EXPECTED_SHEETS].sort());
  for (const name of EXPECTED_SHEETS) {
    assert.equal(C.SHEET_NAMES_[name], name, `${name} must be in SHEET_NAMES_`);
  }
});

test('LEADS carries the v1 columns in order, then the additions (3.3)', () => {
  assert.deepEqual(C.SCHEMA_.LEADS.headers.slice(0, 27), ['lead_id', 'address', 'seller_name',
    'phone', 'source', 'equity_note', 'status', 'assigned_to', 'team', 'flag_juan',
    'compliance_mailer_check', 'contact_attempts', 'next_action', 'due_date', 'arv', 'repairs',
    'asking_price', 'offer', 'appointment_date', 'appointment_outcome', 'archive_reason',
    'created_by', 'created_at', 'updated_by', 'updated_at', 'last_touched_at', 'version']);
  assert.deepEqual(C.SCHEMA_.LEADS.headers.slice(27), ['address_normalized', 'phone_normalized',
    'recent_notes_json', 'last_note_at', 'flagged_at', 'compliance_flagged_at', 'appointment_time',
    'possible_duplicate_of', 'legacy_id']);
});

test('every sheet is internally consistent', () => {
  for (const [name, def] of Object.entries(C.SCHEMA_)) {
    const headers = def.headers;
    assert.equal(new Set(headers).size, headers.length, `${name} has a duplicate column`);
    assert.equal(headers.includes(def.idColumn), true, `${name}.idColumn must be a real column`);
    for (const numeric of def.numbers) {
      assert.equal(headers.includes(numeric), true, `${name}.numbers: ${numeric} is not a column`);
    }
    for (const flag of def.booleans) {
      assert.equal(headers.includes(flag), true, `${name}.booleans: ${flag} is not a column`);
    }
    for (const header of headers) {
      assert.match(header, /^[a-z][a-z0-9_]*$/, `${name}.${header} should be snake_case`);
    }
  }
});

test('columnKinds_ marks numbers and booleans and leaves text alone', () => {
  const kinds = C.columnKinds_('LEADS');
  assert.equal(kinds.arv, 'number');
  assert.equal(kinds.version, 'number');
  assert.equal(kinds.contact_attempts, 'number');
  assert.equal(kinds.flag_juan, 'bool');
  assert.equal(kinds.compliance_mailer_check, 'bool');
  assert.equal(kinds.address, undefined, 'text columns are written as text');
  assert.equal(kinds.due_date, undefined, 'dates are plain text, never numbers');
  assert.equal(kinds.phone, undefined, 'phones are plain text so leading zeros survive');
  assert.equal(kinds.lead_id, undefined);
});

test('dates, timestamps, ids and phones are never numeric or boolean columns (3.2.2)', () => {
  for (const [name, def] of Object.entries(C.SCHEMA_)) {
    for (const header of def.headers) {
      const looksTemporal = /(^|_)(date|at|timestamp)$/.test(header) ||
        header.endsWith('_date') || header.endsWith('_at');
      const looksIdentifier = header.endsWith('_id') || header === 'phone';
      if (looksTemporal || looksIdentifier) {
        assert.equal(def.numbers.includes(header), false, `${name}.${header} must not be numeric`);
        assert.equal(def.booleans.includes(header), false, `${name}.${header} must not be boolean`);
      }
    }
  }
});

test('the append-only history sheets are marked as such (rule 1.6)', () => {
  for (const name of ['LEAD_ACTIVITY', 'TOOL_RUNS', 'AUDIT_LOG', 'ERROR_LOG', 'BACKUP_LOG']) {
    assert.equal(C.SCHEMA_[name].appendOnly, true, `${name} must be append-only`);
  }
  assert.equal(C.SCHEMA_.TEST_RESULTS.devOnly, true, 'TEST_RESULTS is DEV only (3.3)');
});

test('LEAD_ACTIVITY can record every action type the activity engine writes (3.3)', () => {
  const required = ['activity_id', 'lead_id', 'user_id', 'user_name', 'user_email', 'business_date',
    'timestamp_utc', 'action_type', 'field_changed', 'old_value', 'new_value', 'note',
    'client_request_id'];
  assert.deepEqual(C.SCHEMA_.LEAD_ACTIVITY.headers, required);
});

test('the SETTINGS seed carries all twelve keys with the pinned start values (3.3)', () => {
  const seeded = Object.fromEntries(C.SETTINGS_SEED_);
  assert.deepEqual(seeded, {
    monthly_deal_target: '3',
    monthly_marketing_budget: '0',
    mao_percentage: '70',
    stale_lead_days: '7',
    business_timezone: 'America/Los_Angeles',
    auto_refresh_seconds: '30',
    app_version: '1.0.0',
    live_list_target: '200',
    team_queues: 'MX,PH,CA',
    rep_sees_all_leads: 'TRUE',
    backup_retention_days: '60',
    schema_version: '1'
  });
});

test('the five pillars are seeded in prototype order (2.1)', () => {
  assert.deepEqual(C.PILLARS_SEED_.map((p) => p[1]),
    ['Lead scoring', 'Seller outreach', 'Follow-up', 'Contract generation', 'Reporting']);
});

test('the rollcall seeds exactly the three builders (2.1)', () => {
  assert.deepEqual(C.BUILDERS_SEED_, ['Seth', 'Jonathan', 'Bryan']);
});

// G2 default: names from both lists, never an invented email.
test('the USERS seed covers both name lists and excludes the non-people', () => {
  for (const name of ['Juan', 'David', 'Diego', 'Era', 'Barbie', 'Thea']) {
    assert.equal(C.USERS_SEED_NAMES_.includes(name), true, `${name} from the v1 list`);
  }
  for (const name of ['Cherry', 'Genesis', 'Jonathan', 'Seth', 'Bryan']) {
    assert.equal(C.USERS_SEED_NAMES_.includes(name), true, `${name} from the prototype`);
  }
  for (const notAPerson of ['Sales manager', 'Mexico team']) {
    assert.equal(C.USERS_SEED_NAMES_.includes(notAPerson), false,
      `${notAPerson} is a role or a queue, not a user`);
  }
  for (const operator of ['Christine', 'Danny', 'MC']) {
    assert.equal(C.USERS_SEED_NAMES_.includes(operator), false,
      `${operator} operates a tool but is not an app user`);
  }
  assert.equal(new Set(C.USERS_SEED_NAMES_).size, C.USERS_SEED_NAMES_.length);
});

test('provisionalNameFromEmail_ gives an admin something to correct, not a guess at identity', () => {
  assert.equal(C.provisionalNameFromEmail_('juan.diaz@twinhomebuyer.com'), 'Juan Diaz');
  assert.equal(C.provisionalNameFromEmail_('thea@twinhomebuyer.com'), 'Thea');
});

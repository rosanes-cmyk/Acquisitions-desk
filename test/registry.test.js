'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, SRC_DIR } = require('./helpers/loadPure');

// Loading EVERY server file into one context mirrors how Apps Script shares a
// global scope across .gs files. It proves the whole project links up: a service
// named in the registry but never defined fails right here.
const ALL_FILES = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
const C = loadPure(ALL_FILES);

/** Every action name listed in 4.10. */
const SPEC_ACTIONS = [
  'bootstrap', 'getChangeStamp',
  'listLeads', 'getLead', 'getLeadActivity', 'createLead', 'addBulkLeads', 'updateLead',
  'assignLead', 'logAttempt', 'addLeadNote', 'setNextAction', 'completeNextAction',
  'setJuanFlag', 'setComplianceFlag', 'archiveLead', 'restoreLead',
  'listAppointments',
  'getTodayDashboard', 'getJuanDashboard', 'getRepSnapshot', 'getWorkQueue',
  'getDailyMetrics', 'saveDailyMetrics', 'getNumbersDashboard',
  'getTools', 'createTool', 'updateTool', 'setToolTraining', 'logToolRun', 'voidToolRun',
  'getRunsToday', 'setPillarState', 'setBuilderAsked',
  'getSettings', 'saveSetting',
  'getUsers', 'createUser', 'updateUser', 'disableUser', 'getAuditLog', 'getErrorLog',
  'getBackups', 'runBackupNow', 'runSelfTests'
];

test('every file in src/ loads into one shared scope, as Apps Script does', () => {
  assert.equal(ALL_FILES.length >= 16, true, `expected the full project, got ${ALL_FILES.length}`);
  assert.equal(typeof C.api, 'function');
  assert.equal(typeof C.doGet, 'function');
});

test('every action named in 4.10 is registered and wired to a real function', () => {
  const registry = C.actionRegistry_();
  for (const action of SPEC_ACTIONS) {
    assert.equal(action in registry, true, `action "${action}" is missing from the registry`);
    assert.equal(typeof registry[action].fn, 'function',
      `action "${action}" is not wired to a function`);
  }
});

test('the registry adds nothing beyond the spec except the Numbers save', () => {
  const registry = C.actionRegistry_();
  const extra = Object.keys(registry).filter((a) => !SPEC_ACTIONS.includes(a));
  // saveTargets is the Numbers tab's Save targets button, which 5.8 requires and
  // 4.10 folds into saveSetting; it is a thin MANAGER+ wrapper over two keys.
  assert.deepEqual(extra, ['saveTargets']);
});

test('there is no generic write action and no delete action, for any role', () => {
  const registry = C.actionRegistry_();
  for (const action of Object.keys(registry)) {
    assert.equal(/delete|remove|destroy|purge|drop/i.test(action), false,
      `"${action}" looks like a delete action - rule 1.6 forbids one`);
    assert.equal(/^(write|set|put)(Row|Cell|Range|Any)/i.test(action), false,
      `"${action}" looks like a generic write`);
  }
  assert.equal('permanentDelete' in C.CAPABILITIES_, false);
});

test('every registered capability actually exists in the permission matrix', () => {
  const registry = C.actionRegistry_();
  for (const [action, definition] of Object.entries(registry)) {
    if (definition.role === null) continue;
    assert.equal(definition.role in C.CAPABILITIES_,
      true, `action "${action}" needs capability "${definition.role}", which is not defined`);
  }
});

test('the permission matrix matches 4.3 where it matters most', () => {
  const rep = { role: 'REP' };
  const manager = { role: 'MANAGER' };
  const admin = { role: 'ADMIN' };
  const technical = { role: 'TECHNICAL' };

  // A REP works the board...
  for (const capability of ['createLead', 'editLead', 'logAttempt', 'addNote', 'archiveLead',
    'setJuanFlag', 'setComplianceFlag', 'saveDailyMetrics', 'markToolRun']) {
    assert.equal(C.can_(rep, capability), true, `a REP should be able to ${capability}`);
  }
  // ...but not these.
  for (const capability of ['clearComplianceFlag', 'restoreLead', 'saveTargets', 'editTools',
    'manageUsers', 'manageSettings', 'viewAuditLog', 'viewRepSnapshot', 'viewJuanDashboard']) {
    assert.equal(C.can_(rep, capability), false, `a REP must not be able to ${capability}`);
  }

  assert.equal(C.can_(manager, 'clearComplianceFlag'), true);
  assert.equal(C.can_(manager, 'restoreLead'), true);
  assert.equal(C.can_(manager, 'manageUsers'), false, 'users are ADMIN only');
  assert.equal(C.can_(technical, 'editTools'), true);
  assert.equal(C.can_(technical, 'viewErrorLog'), true);
  assert.equal(C.can_(technical, 'restoreLead'), false);
  assert.equal(C.can_(admin, 'manageUsers'), true);
  assert.equal(C.can_({ role: 'NONSENSE' }, 'editLead'), false, 'an unknown role gets nothing');
  assert.equal(C.can_(admin, 'noSuchCapability'), false, 'an unknown capability is never allowed');
});

// 4.3: the client never sends identity.
test('stripIdentityFields_ drops every claim about who the caller is', () => {
  const safe = C.stripIdentityFields_({
    leadId: 'LEAD-1',
    user_id: 'USR-SOMEONE-ELSE',
    user: { role: 'ADMIN' },
    user_email: 'juan@twinhomebuyer.com',
    email: 'juan@twinhomebuyer.com',
    role: 'ADMIN',
    ctx: { role: 'ADMIN' },
    actingUser: 'USR-JUAN',
    patch: { status: 'NEW' }
  });
  assert.deepEqual(safe, { leadId: 'LEAD-1', patch: { status: 'NEW' } });
  assert.deepEqual(C.stripIdentityFields_(null), {});
  assert.deepEqual(C.stripIdentityFields_('nonsense'), {});
});

// userId names the person being acted ON in three actions in 4.10, so stripping
// it would break them. The services validate it against USERS.
test('userId survives, because it is a target, not a claim about the caller', () => {
  assert.deepEqual(
    C.stripIdentityFields_({ toolId: 'retell', userId: 'USR-1', trained: true }),
    { toolId: 'retell', userId: 'USR-1', trained: true }
  );
});

test('no service reads the caller identity out of a payload', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ALL_FILES) {
    const source = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    for (const key of C.CALLER_IDENTITY_KEYS_) {
      // \b so payload.userId does not read as payload.user.
      const reads = new RegExp(`payload\\.${key}\\b`);
      assert.equal(reads.test(source), false,
        `${file} reads payload.${key} - identity must come from ctx`);
    }
  }
});

test('api() refuses an unknown action without resolving identity at all', () => {
  // getCurrentUser_ would need Session, which does not exist under Node. That the
  // call returns an envelope proves the whitelist is checked first.
  const envelope = C.api('deleteAllLeads', {});
  assert.deepEqual(envelope, {
    ok: false, code: 'VALIDATION_ERROR', message: 'Unknown action: deleteAllLeads'
  });
  assert.equal(C.api('', {}).ok, false);
  assert.equal(C.api(undefined, undefined).ok, false);
});

test('the five editor-run globals exist and are the only extra globals', () => {
  for (const name of ['setupDatabase', 'installTriggers', 'createDatabaseBackup', 'runSelfTests',
    'createTestData']) {
    assert.equal(typeof C[name], 'function', `${name} must exist as a guarded entry point`);
  }
});

test('the daily metrics whitelist is exactly the 13 fields a person types (3.3)', () => {
  assert.deepEqual(C.DAILY_METRIC_FIELDS_, ['tv_spend', 'ppc_spend', 'ppl_spend', 'other_spend',
    'new_leads', 'inbound_calls', 'missed_calls', 'sellers_reached', 'appointments_set',
    'contracts_signed', 'contracts_fell_out', 'deals_closed', 'minutes_to_first_call']);
  for (const serverOwned of ['business_date', 'version', 'created_by', 'updated_by']) {
    assert.equal(C.DAILY_METRIC_FIELDS_.includes(serverOwned), false,
      `${serverOwned} must not be client-writable`);
  }
});

test('the tool whitelist excludes ids, versions and timestamps', () => {
  for (const serverOwned of ['tool_id', 'version', 'created_at', 'updated_at', 'is_seeded']) {
    assert.equal(C.TOOL_PATCH_FIELDS_.includes(serverOwned), false,
      `${serverOwned} must not be client-writable`);
  }
  assert.equal(C.TOOL_PATCH_FIELDS_.includes('cadence'), true);
  assert.equal(C.TOOL_PATCH_FIELDS_.includes('asked_builder_date'), true,
    'the per-tool asked date must be editable - the prototype dropped it (C1)');
});

test('every action_type the activity engine can write is declared (3.3)', () => {
  const required = ['LEAD_CREATED', 'LEAD_IMPORTED', 'CALL_ATTEMPT', 'NOTE_ADDED',
    'STATUS_CHANGED', 'ASSIGNED', 'NEXT_ACTION_CHANGED', 'NEXT_ACTION_COMPLETED',
    'DUE_DATE_CHANGED', 'APPOINTMENT_SET', 'APPOINTMENT_UPDATED', 'UNDERWRITING_CHANGED',
    'OFFER_CHANGED', 'FLAGGED_FOR_JUAN', 'JUAN_FLAG_CLEARED', 'COMPLIANCE_FLAGGED',
    'COMPLIANCE_CLEARED', 'ARCHIVED', 'RESTORED', 'LEAD_UPDATED', 'LEAD_DUPLICATE_SUSPECTED'];
  assert.deepEqual(C.ALL_ACTION_TYPES_.sort(), [...required].sort());
});

test('the auto-note wording is the prototype wording, verbatim (2.1)', () => {
  assert.equal(C.autoNoteText_('STATUS_CHANGED', 'APPOINTMENT_SET'), 'Moved to Appointment set');
  assert.equal(C.autoNoteText_('APPOINTMENT_UPDATED', 'Offer made'), 'Visit outcome: Offer made');
  assert.equal(C.autoNoteText_('DUE_DATE_CHANGED', '2026-09-18'), 'Next action due 2026-09-18');
  assert.equal(C.autoNoteText_('FLAGGED_FOR_JUAN'), 'Flagged for Juan');
  assert.equal(C.autoNoteText_('JUAN_FLAG_CLEARED'), 'Flag cleared');
  assert.equal(C.autoNoteText_('COMPLIANCE_FLAGGED'),
    'Seller mentioned a mailer or check. Conversation stopped, routed to Juan.');
  assert.equal(C.autoNoteText_('COMPLIANCE_CLEARED'), 'Mailer note cleared');
  assert.equal(C.autoNoteText_('CALL_ATTEMPT', 3), 'Contact attempt 3');
  assert.equal(C.autoNoteText_('NEXT_ACTION_COMPLETED', 'Call back'), 'Done: Call back');
});

test('recent notes keep only the last four, oldest dropped first (6.3)', () => {
  const ctx = { name: 'Juan', email: 'juan@twinhomebuyer.com' };
  let json = '[]';
  for (const text of ['one', 'two', 'three', 'four', 'five']) {
    json = C.appendRecentNotes_(json, [C.noteEntry_(ctx, text, '2026-09-11T18:00:00Z')]);
  }
  const notes = JSON.parse(json);
  assert.equal(notes.length, 4);
  assert.deepEqual(notes.map((n) => n.text), ['two', 'three', 'four', 'five']);
  assert.equal(notes[0].by, 'Juan');
});

test('a hand-corrupted recent_notes_json degrades to empty instead of breaking the board', () => {
  assert.deepEqual(C.parseRecentNotes_('not json'), []);
  assert.deepEqual(C.parseRecentNotes_('{"not":"an array"}'), []);
  assert.deepEqual(C.parseRecentNotes_(''), []);
  assert.deepEqual(C.parseRecentNotes_(null), []);
});

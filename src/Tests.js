/**
 * Tests.js - Tier 2 service-level self-tests, run against the DEV database (7).
 *
 * These call the services with CONSTRUCTED ctx objects (4.2.5). That is how role
 * rules get exercised without adding any client-facing hook: there is no test
 * action in the api registry that could weaken production.
 *
 * ENV must be DEV. Every row created here is prefixed "TEST - ".
 */

var TEST_PREFIX_ = 'TEST - ';

/**
 * GUARDED EDITOR-RUN ENTRY POINT (4.2.3). DEV only.
 * Also reachable from the Admin tab's "Run self-tests" button.
 */
function runSelfTests() {
  var ctx = requireRole_(ROLE_ADMIN_);
  return runSelfTestsInternal_(ctx);
}

function runSelfTestsInternal_(ctx) {
  requireDev_('runSelfTests');
  requireCapability_(ctx, 'runSelfTests', 'run the self-tests');

  var nowIso = nowIsoUtc_();
  var runId = newUniqueId_(ID_PREFIX_.EVENT, compactStamp_(nowIso));
  var results = [];

  var before = rowCounts_();

  runCase_(results, '01 setupDatabase is idempotent', testSetupIdempotent_);
  runCase_(results, '02 createLead writes the row, the activity and the audit row', testCreateLead_);
  runCase_(results, '03 updateLead patches only what changed and bumps the version', testUpdateLead_);
  runCase_(results, '04 same-record conflict is refused and nothing is written', testConflict_);
  runCase_(results, '05 two different leads both persist', testDifferentRecords_);
  runCase_(results, '06 every action writes exactly one activity row', testActivityPerAction_);
  runCase_(results, '07 the compliance flag raises Juan and keeps the lead live', testCompliance_);
  runCase_(results, '08 the work queue classifies all five cases', testQueue_);
  runCase_(results, '09 saving the daily numbers twice updates one row', testDailyMetrics_);
  runCase_(results, '10 the Numbers dashboard matches hand-computed values', testNumbers_);
  runCase_(results, '11 tools: run, undo, training and streak', testTools_);
  runCase_(results, '12 bulk import reports every row', testBulkImport_);
  runCase_(results, '13 role checks refuse what they should', testRoles_);
  runCase_(results, '15 a backup lands in the folder and is logged', testBackup_);
  runCase_(results, '16 api() returns an envelope for a garbage payload', testGarbagePayload_);

  // 14 must run last: it compares row counts across the whole suite.
  runCase_(results, '14 nothing was hard-deleted during the suite', function () {
    var after = rowCounts_();
    for (var sheetName in before) {
      if (!Object.prototype.hasOwnProperty.call(before, sheetName)) continue;
      assert_(after[sheetName] >= before[sheetName],
        sheetName + ' lost rows: ' + before[sheetName] + ' -> ' + after[sheetName]);
    }
  });

  results.push({
    test_name: '17 client-callable surface is limited',
    result: 'INFO',
    details: 'Enforced statically by tools/check-globals.js on every npm test; it cannot be ' +
      'checked from inside Apps Script. See the Tier 1 output in the completion report.'
  });

  var passed = results.filter(function (r) { return r.result === 'PASS'; }).length;
  var failed = results.filter(function (r) { return r.result === 'FAIL'; }).length;

  appendRows_(SHEET_NAMES_.TEST_RESULTS, results.map(function (result) {
    return {
      run_id: runId,
      timestamp_utc: nowIso,
      tier: 'Tier 2',
      test_name: result.test_name,
      result: result.result,
      details: trimTo_(result.details, 1000)
    };
  }), columnKinds_(SHEET_NAMES_.TEST_RESULTS));

  auditSafely_(ctx.user_id, ctx.email, 'SELF_TESTS_RUN', 'system', runId,
    passed + ' passed, ' + failed + ' failed');

  var summary = { runId: runId, passed: passed, failed: failed, total: results.length,
    results: results };
  Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

/* ------------------------------------------------------------- harness */

function runCase_(results, name, fn) {
  try {
    fn();
    results.push({ test_name: name, result: 'PASS', details: '' });
  } catch (err) {
    results.push({ test_name: name, result: 'FAIL',
      details: (err && err.message ? err.message : String(err)) });
  }
}

function assert_(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual_(actual, expected, message) {
  if (String(actual) !== String(expected)) {
    throw new Error(message + ' (expected ' + expected + ', got ' + actual + ')');
  }
}

function assertThrowsCode_(fn, code, message) {
  try {
    fn();
  } catch (err) {
    assertEqual_(err.code, code, message + ': wrong code');
    return err;
  }
  throw new Error(message + ': nothing was thrown');
}

/** Synthetic contexts (4.2.5). No client hook exists that could produce these. */
function testCtx_(role) {
  return {
    user_id: 'USR-TEST-' + role,
    name: 'Test ' + role,
    email: 'test.' + role.toLowerCase() + '@test.invalid',
    role: role,
    team: 'CA'
  };
}

function rowCounts_() {
  var counts = {};
  ['LEADS', 'LEAD_ACTIVITY', 'TOOL_RUNS', 'AUDIT_LOG'].forEach(function (name) {
    var target = sheet_(SHEET_NAMES_[name]);
    counts[name] = Math.max(0, target.getLastRow() - 1);
  });
  return counts;
}

function makeTestLead_(ctx, label) {
  return createLead_(ctx, {
    data: {
      address: TEST_PREFIX_ + label,
      seller_name: 'Test Seller',
      phone: '5105550000',
      source: 'PPC',
      equity_note: 'self-test'
    }
  });
}

function activityCountFor_(leadId) {
  return readLeadActivity_(leadId, 500).length;
}

function uniqueLabel_(base) {
  return base + ' ' + nowIsoUtc_().replace(/[^0-9]/g, '').slice(8);
}

/* ---------------------------------------------------------------- cases */

function testSetupIdempotent_() {
  var headersBefore = headersOf_(sheet_(SHEET_NAMES_.LEADS)).join('|');
  var settingsBefore = readAll_(SHEET_NAMES_.SETTINGS).length;
  var pillarsBefore = readAll_(SHEET_NAMES_.PILLARS).length;

  setupDatabase();

  assertEqual_(headersOf_(sheet_(SHEET_NAMES_.LEADS)).join('|'), headersBefore,
    'LEADS headers changed on a second setup run');
  assertEqual_(readAll_(SHEET_NAMES_.SETTINGS).length, settingsBefore, 'SETTINGS was re-seeded');
  assertEqual_(readAll_(SHEET_NAMES_.PILLARS).length, pillarsBefore, 'PILLARS was re-seeded');
}

function testCreateLead_() {
  var ctx = testCtx_(ROLE_REP_);
  var lead = makeTestLead_(ctx, uniqueLabel_('100 Main Street'));

  assert_(!!lead.lead_id, 'no lead_id was returned');
  assertEqual_(lead.version, 1, 'a new lead should be version 1');
  assertEqual_(lead.status, STATUS_.NEW, 'a new lead should be NEW');

  var stored = findRowById_(SHEET_NAMES_.LEADS, 'lead_id', lead.lead_id);
  assert_(stored, 'the lead row was not written');
  assertEqual_(stored.record.address, lead.address, 'the stored address does not match');
  assert_(!!stored.record.address_normalized, 'address_normalized was not computed');

  var activity = readLeadActivity_(lead.lead_id, 10);
  assertEqual_(activity.length, 1, 'expected exactly one activity row');
  assertEqual_(activity[0].action_type, ACTION_.LEAD_CREATED, 'wrong action_type');
  assertEqual_(activity[0].user_id, ctx.user_id, 'the activity row names the wrong user');

  var audit = readAll_(SHEET_NAMES_.AUDIT_LOG).filter(function (row) {
    return row.entity_id === lead.lead_id && row.action === 'LEAD_CREATED';
  });
  assertEqual_(audit.length, 1, 'expected one AUDIT_LOG row');
}

function testUpdateLead_() {
  var ctx = testCtx_(ROLE_REP_);
  var lead = makeTestLead_(ctx, uniqueLabel_('200 Oak Avenue'));
  var sellerBefore = lead.seller_name;

  var updated = updateLead_(ctx, {
    leadId: lead.lead_id,
    patch: { arv: 300000, repairs: 30000 },
    expectedVersion: lead.version
  });

  assertEqual_(updated.version, lead.version + 1, 'the version did not increment');
  assertEqual_(updated.arv, 300000, 'arv was not saved');
  assertEqual_(updated.seller_name, sellerBefore, 'an untouched column was rewritten');
  assertEqual_(updated.mao, 300000 * settingNumber_('mao_percentage', 70) / 100 - 30000,
    'MAO was not computed from SETTINGS');

  var activity = readLeadActivity_(lead.lead_id, 10);
  var underwriting = activity.filter(function (row) {
    return row.action_type === ACTION_.UNDERWRITING_CHANGED;
  });
  assertEqual_(underwriting.length, 1, 'expected one UNDERWRITING_CHANGED row');

  // A no-op patch must not write anything (finding C3).
  var versionBefore = updated.version;
  var again = updateLead_(ctx, {
    leadId: lead.lead_id, patch: { arv: 300000 }, expectedVersion: versionBefore
  });
  assertEqual_(again.version, versionBefore, 'an unchanged value still bumped the version');
}

/** v1 TEST B. */
function testConflict_() {
  var ctx = testCtx_(ROLE_REP_);
  var lead = makeTestLead_(ctx, uniqueLabel_('300 Pine Court'));

  var first = updateLead_(ctx, {
    leadId: lead.lead_id, patch: { seller_name: 'Writer A' }, expectedVersion: lead.version
  });
  assertEqual_(first.seller_name, 'Writer A', 'the first write did not land');

  var err = assertThrowsCode_(function () {
    updateLead_(ctx, {
      leadId: lead.lead_id, patch: { seller_name: 'Writer B' }, expectedVersion: lead.version
    });
  }, 'CONFLICT_RECORD_CHANGED', 'the stale write should have been refused');

  assert_(!!err.data, 'the conflict should carry the latest record');
  var stored = findRowById_(SHEET_NAMES_.LEADS, 'lead_id', lead.lead_id);
  assertEqual_(stored.record.seller_name, 'Writer A', "Writer B's change was written anyway");
}

/** v1 TEST A. */
function testDifferentRecords_() {
  var ctx = testCtx_(ROLE_REP_);
  var one = makeTestLead_(ctx, uniqueLabel_('400 First Street'));
  var two = makeTestLead_(ctx, uniqueLabel_('500 Second Street'));

  updateLead_(ctx, { leadId: one.lead_id, patch: { offer: 111 }, expectedVersion: one.version });
  updateLead_(ctx, { leadId: two.lead_id, patch: { offer: 222 }, expectedVersion: two.version });

  assertEqual_(findRowById_(SHEET_NAMES_.LEADS, 'lead_id', one.lead_id).record.offer, 111,
    'the first lead lost its change');
  assertEqual_(findRowById_(SHEET_NAMES_.LEADS, 'lead_id', two.lead_id).record.offer, 222,
    'the second lead lost its change');
}

function testActivityPerAction_() {
  var ctx = testCtx_(ROLE_MANAGER_);
  var lead = makeTestLead_(ctx, uniqueLabel_('600 Cedar Lane'));
  var count = activityCountFor_(lead.lead_id);
  var current = lead;

  function step(label, fn, expectedRows) {
    current = fn(current);
    var now = activityCountFor_(lead.lead_id);
    assertEqual_(now - count, expectedRows, label + ' wrote the wrong number of activity rows');
    count = now;
  }

  step('status change', function (lead) {
    return updateLead_(ctx, { leadId: lead.lead_id, patch: { status: STATUS_.CONTACT_MADE },
      expectedVersion: lead.version });
  }, 1);

  step('note', function (lead) {
    return addLeadNote_(ctx, { leadId: lead.lead_id, text: 'A self-test note.' });
  }, 1);

  step('attempt', function (lead) {
    return logAttempt_(ctx, { leadId: lead.lead_id, expectedVersion: lead.version });
  }, 1);

  step('assignment', function (lead) {
    return assignLead_(ctx, { leadId: lead.lead_id, assignedTo: teamQueue_('CA'),
      expectedVersion: lead.version });
  }, 1);

  step('next action and due date', function (lead) {
    return setNextAction_(ctx, { leadId: lead.lead_id, nextAction: 'Call back',
      dueDate: businessToday_(), expectedVersion: lead.version });
  }, 2);

  step('appointment', function (lead) {
    return updateLead_(ctx, { leadId: lead.lead_id,
      patch: { appointment_date: addDays_(businessToday_(), 2), appointment_time: '14:30' },
      expectedVersion: lead.version });
  }, 1);

  step('visit outcome', function (lead) {
    return updateLead_(ctx, { leadId: lead.lead_id, patch: { appointment_outcome: 'Offer made' },
      expectedVersion: lead.version });
  }, 1);

  step('Juan flag', function (lead) {
    return setJuanFlag_(ctx, { leadId: lead.lead_id, on: true, expectedVersion: lead.version });
  }, 1);

  step('clear Juan flag', function (lead) {
    return setJuanFlag_(ctx, { leadId: lead.lead_id, on: false, expectedVersion: lead.version });
  }, 1);

  step('underwriting', function (lead) {
    return updateLead_(ctx, { leadId: lead.lead_id, patch: { arv: 250000, repairs: 10000 },
      expectedVersion: lead.version });
  }, 1);

  step('offer', function (lead) {
    return updateLead_(ctx, { leadId: lead.lead_id, patch: { offer: 150000 },
      expectedVersion: lead.version });
  }, 1);

  step('complete next action', function (lead) {
    return completeNextAction_(ctx, { leadId: lead.lead_id, expectedVersion: lead.version });
  }, 1);

  step('archive', function (lead) {
    return archiveLead_(ctx, { leadId: lead.lead_id, archivedStatus: STATUS_.ARCHIVED_NO_EQUITY,
      expectedVersion: lead.version });
  }, 1);

  step('restore', function (lead) {
    return restoreLead_(ctx, { leadId: lead.lead_id, toStatus: STATUS_.NEW,
      expectedVersion: lead.version });
  }, 1);

  assertEqual_(current.status, STATUS_.NEW, 'the restored lead is not live again');
  assertEqual_(current.archive_reason, '', 'archive_reason was not cleared on restore');
}

function testCompliance_() {
  var rep = testCtx_(ROLE_REP_);
  var manager = testCtx_(ROLE_MANAGER_);
  var lead = makeTestLead_(rep, uniqueLabel_('700 Mailer Road'));

  var flagged = setComplianceFlag_(rep, { leadId: lead.lead_id, on: true,
    expectedVersion: lead.version });

  assert_(flagged.compliance_mailer_check, 'the compliance flag was not set');
  assert_(flagged.flag_juan, 'the compliance flag must also raise the Juan flag');
  assert_(!!flagged.compliance_flagged_at, 'compliance_flagged_at was not stamped');
  assert_(isLiveStatus_(flagged.status), 'a compliance lead must stay live');

  var waiting = getTodayDashboard_(manager, {}).waitingOnJuan.filter(function (row) {
    return row.lead_id === lead.lead_id;
  });
  assertEqual_(waiting.length, 1, 'the lead is not in Waiting on Juan');
  assertEqual_(waiting[0].reason, 'Mailer or check mentioned', 'the reason is wrong');

  assertThrowsCode_(function () {
    setComplianceFlag_(rep, { leadId: lead.lead_id, on: false,
      expectedVersion: flagged.version });
  }, 'ACCESS_DENIED', 'a REP must not be able to clear the mailer note');

  var cleared = setComplianceFlag_(manager, { leadId: lead.lead_id, on: false,
    expectedVersion: flagged.version });
  assert_(!cleared.compliance_mailer_check, 'a manager could not clear the mailer note');
}

function testQueue_() {
  var ctx = testCtx_(ROLE_MANAGER_);
  var today = businessToday_();
  var label = uniqueLabel_('Queue');

  var overdue = makeTestLead_(ctx, label + ' overdue');
  var dueToday = makeTestLead_(ctx, label + ' due today');
  var future = makeTestLead_(ctx, label + ' future');
  var noAction = makeTestLead_(ctx, label + ' no next action');
  var noDue = makeTestLead_(ctx, label + ' no due date');

  overdue = setNextAction_(ctx, { leadId: overdue.lead_id, nextAction: 'Chase',
    dueDate: addDays_(today, -3), expectedVersion: overdue.version });
  dueToday = setNextAction_(ctx, { leadId: dueToday.lead_id, nextAction: 'Chase',
    dueDate: today, expectedVersion: dueToday.version });
  future = setNextAction_(ctx, { leadId: future.lead_id, nextAction: 'Chase',
    dueDate: addDays_(today, 3), expectedVersion: future.version });
  noDue = setNextAction_(ctx, { leadId: noDue.lead_id, nextAction: 'Chase', dueDate: '',
    expectedVersion: noDue.version });

  var queue = getWorkQueue_(ctx);
  function has(section, leadId) {
    return queue[section].some(function (row) { return row.lead_id === leadId; });
  }

  assert_(has('overdue', overdue.lead_id), 'the overdue lead is not in Overdue');
  assert_(has('dueToday', dueToday.lead_id), 'the due-today lead is not in Due today');
  assert_(has('upcoming', future.lead_id), 'the future lead is not in Upcoming');
  assert_(has('noNextAction', noAction.lead_id), 'the lead with no next action is missing');
  assert_(has('noDueDate', noDue.lead_id), 'the lead with no due date is missing');
  assert_(!has('noNextAction', overdue.lead_id), 'sections should be mutually exclusive');
}

function testDailyMetrics_() {
  var ctx = testCtx_(ROLE_REP_);
  var date = addDays_(businessToday_(), -400); // far outside every dashboard window

  var first = saveDailyMetrics_(ctx, { date: date, data: { new_leads: 5, inbound_calls: 3 } });
  assertEqual_(first.version, 1, 'the first save should be version 1');

  var second = saveDailyMetrics_(ctx, {
    date: date, data: { new_leads: 9, minutes_to_first_call: '' },
    expectedVersion: first.version
  });
  assertEqual_(second.version, 2, 'the second save should be version 2');
  assertEqual_(second.data.new_leads, 9, 'the value was not updated');
  assert_(second.data.minutes_to_first_call === null, 'a blank must stay blank, not become 0');

  var rows = readAll_(SHEET_NAMES_.DAILY_METRICS).filter(function (row) {
    return String(row.business_date) === date;
  });
  assertEqual_(rows.length, 1, 'saving twice created a second row');

  assertThrowsCode_(function () {
    saveDailyMetrics_(ctx, { date: date, data: { new_leads: 1 }, expectedVersion: 1 });
  }, 'CONFLICT_RECORD_CHANGED', 'a stale metrics save should be refused');
}

function testNumbers_() {
  var ctx = testCtx_(ROLE_MANAGER_);
  var dashboard = getNumbersDashboard_(ctx, {});
  var window30 = rowsInWindow30_(readAll_(SHEET_NAMES_.DAILY_METRICS), businessToday_());

  assertEqual_(dashboard.funnel.newLeads, sumField_(window30, 'new_leads'),
    'the funnel does not match the 30-day rows');
  assertEqual_(dashboard.costs.spend, totalSpend_(window30), 'spend does not match');
  assertEqual_(dashboard.channels.length, 4, 'there should be four channels');

  var spendByChannel = dashboard.channels.reduce(function (total, row) {
    return total + row.spend;
  }, 0);
  assertEqual_(spendByChannel, totalSpend_(window30),
    'the channel spends do not add up to total spend');

  if (dashboard.funnel.contracts === 0) {
    assert_(dashboard.costs.perContract === null,
      'cost per contract must be null, not 0, when there are no contracts');
  }
}

function testTools_() {
  var ctx = testCtx_(ROLE_TECHNICAL_);
  var tool = createTool_(ctx, {
    data: { name: TEST_PREFIX_ + uniqueLabel_('Tool'), built_by: 'Seth',
      link: 'https://example.com/tool', description: 'self-test tool' }
  });

  assertThrowsCode_(function () {
    updateTool_(ctx, { toolId: tool.tool_id, patch: { link: 'javascript:alert(1)' },
      expectedVersion: tool.version });
  }, 'VALIDATION_ERROR', 'a javascript: link should be refused');

  var updated = updateTool_(ctx, {
    toolId: tool.tool_id,
    patch: { cadence: 'Every day', operator: 'Christine', status: 'Live and used daily' },
    expectedVersion: tool.version
  });
  assertEqual_(updated.cadence, 'Every day', 'the cadence was not saved');
  assert_(updated.is_daily, 'an Every day tool should be a daily tool');

  var admin = readAll_(SHEET_NAMES_.USERS).filter(function (user) {
    return toBool_(user.active);
  })[0];
  if (admin) {
    setToolTraining_(ctx, { toolId: tool.tool_id, userId: admin.user_id, trained: true });
    var withTraining = getTools_(ctx).tools.filter(function (row) {
      return row.tool_id === tool.tool_id;
    })[0];
    assert_(withTraining.trained_user_ids.indexOf(String(admin.user_id)) >= 0,
      'the training row was not recorded');
  }

  logToolRun_(ctx, { toolId: tool.tool_id });
  assert_(getRunsToday_(ctx).some(function (run) { return run.tool_id === tool.tool_id; }),
    'the run was not recorded');

  var runsBefore = readAll_(SHEET_NAMES_.TOOL_RUNS).length;
  voidToolRun_(ctx, { toolId: tool.tool_id });

  assert_(!getRunsToday_(ctx).some(function (run) { return run.tool_id === tool.tool_id; }),
    'a voided run should not count as run today');
  assertEqual_(readAll_(SHEET_NAMES_.TOOL_RUNS).length, runsBefore,
    'Undo deleted the row instead of voiding it');

  var voided = readAll_(SHEET_NAMES_.TOOL_RUNS).filter(function (row) {
    return String(row.tool_id) === tool.tool_id && row.status === 'VOIDED';
  });
  assert_(voided.length >= 1, 'no VOIDED row remains');

  // The streak must survive a weekend for an Every weekday tool (6.10).
  var friday = '2026-09-11';
  var runs = {};
  runs[friday] = {}; runs[friday][tool.tool_id] = true;
  runs['2026-09-10'] = {}; runs['2026-09-10'][tool.tool_id] = true;
  var weekdayTool = [{ tool_id: tool.tool_id, cadence: 'Every weekday' }];
  assertEqual_(toolStreak_(weekdayTool, runs, '2026-09-13'), 4,
    'the weekend broke a weekday-only streak');
}

function testBulkImport_() {
  var ctx = testCtx_(ROLE_REP_);
  var label = uniqueLabel_('Bulk');
  var existing = makeTestLead_(ctx, label + ' duplicate target');

  var summary = addBulkLeads_(ctx, {
    rows: [
      { line: 1, address: TEST_PREFIX_ + label + ' fresh one' },
      { line: 2, address: existing.address },
      { line: 3, address: '' },
      { line: 4, address: TEST_PREFIX_ + label + ' phone twin', phone: '5105550000' }
    ]
  });

  assertEqual_(summary.rows.length, 4, 'every row must be accounted for');
  assertEqual_(summary.duplicatesSkipped, 1, 'the duplicate address was not skipped');
  assertEqual_(summary.failed, 1, 'the row with no address should fail');
  assert_(summary.possibleDuplicates >= 1, 'the shared phone should be flagged');

  var failed = summary.rows.filter(function (row) { return row.result === 'FAILED'; })[0];
  assertEqual_(failed.line, 3, 'the failed row reports the wrong line number');
  assert_(!!failed.reason, 'a failed row must carry a reason');

  assertThrowsCode_(function () {
    var tooMany = [];
    for (var i = 0; i <= BULK_IMPORT_MAX_ROWS_; i++) tooMany.push({ address: 'x' });
    addBulkLeads_(ctx, { rows: tooMany });
  }, 'VALIDATION_ERROR', 'more than the chunk size should be refused');
}

function testRoles_() {
  var rep = testCtx_(ROLE_REP_);
  var lead = makeTestLead_(rep, uniqueLabel_('800 Role Street'));

  var archived = archiveLead_(rep, { leadId: lead.lead_id,
    archivedStatus: STATUS_.ARCHIVED_NOT_INTERESTED, expectedVersion: lead.version });

  assertThrowsCode_(function () {
    restoreLead_(rep, { leadId: lead.lead_id, toStatus: STATUS_.NEW,
      expectedVersion: archived.version });
  }, 'ACCESS_DENIED', 'a REP must not restore');

  assertThrowsCode_(function () {
    saveTargets_(rep, { monthly_deal_target: 99 });
  }, 'ACCESS_DENIED', 'a REP must not save targets');

  assertThrowsCode_(function () {
    getUsers_(rep);
  }, 'ACCESS_DENIED', 'a REP must not manage users');

  assertThrowsCode_(function () {
    getAuditLog_(rep, {});
  }, 'ACCESS_DENIED', 'a REP must not read the audit log');

  assertThrowsCode_(function () {
    getRepSnapshot_(rep, {});
  }, 'ACCESS_DENIED', 'a REP must not see the full rep snapshot');

  // A REP may not reassign a lead that belongs to another rep (G5).
  var manager = testCtx_(ROLE_MANAGER_);
  var owned = makeTestLead_(manager, uniqueLabel_('810 Owned Street'));
  owned = assignLead_(manager, { leadId: owned.lead_id, assignedTo: 'USR-TEST-MANAGER',
    expectedVersion: owned.version });
  assertThrowsCode_(function () {
    assignLead_(rep, { leadId: owned.lead_id, assignedTo: rep.user_id,
      expectedVersion: owned.version });
  }, 'ACCESS_DENIED', "a REP must not take another rep's lead");

  assert_(!can_({ role: 'REP' }, 'manageSettings'), 'REP should not have manageSettings');
  assert_(can_({ role: 'ADMIN' }, 'manageSettings'), 'ADMIN should have manageSettings');
  assert_(CAPABILITIES_.permanentDelete === undefined, 'no role may ever hard-delete');
}

function testBackup_() {
  var ctx = testCtx_(ROLE_ADMIN_);
  var before = readAll_(SHEET_NAMES_.BACKUP_LOG).length;
  var result = runBackup_(ctx);

  assert_(!!result.file_id, 'no backup file id was returned');
  var log = readAll_(SHEET_NAMES_.BACKUP_LOG);
  assertEqual_(log.length, before + 1, 'the backup was not logged');
  assertEqual_(log[log.length - 1].status, 'SUCCESS', 'the backup log says it failed');

  DriveApp.getFileById(result.file_id).setTrashed(true); // keep DEV Drive tidy
}

function testGarbagePayload_() {
  var envelope = api('updateLead', { leadId: 'nonsense', patch: { made_up_field: 1 } });
  assert_(envelope && envelope.ok === false, 'a garbage payload should not return ok');
  assert_(['VALIDATION_ERROR', 'NOT_FOUND', 'SERVER_ERROR', 'ACCESS_DENIED']
    .indexOf(envelope.code) >= 0, 'unexpected code: ' + envelope.code);

  var unknown = api('deleteEverything', {});
  assertEqual_(unknown.ok, false, 'an unknown action should be refused');
  assertEqual_(unknown.code, 'VALIDATION_ERROR', 'an unknown action should be a validation error');
}

/* ------------------------------------------------------- createTestData() */

/**
 * GUARDED EDITOR-RUN ENTRY POINT (4.2.3). DEV only.
 * Seeds a small, recognizable data set so a human can click around DEV.
 */
function createTestData() {
  var ctx = requireRole_(ROLE_ADMIN_);
  requireDev_('createTestData');

  var today = businessToday_();
  var made = [];

  ['100 Main Street', '200 Oak Avenue', '300 Pine Court'].forEach(function (address) {
    try {
      var lead = createLead_(ctx, {
        data: { address: TEST_PREFIX_ + address, seller_name: 'Sample Seller',
          phone: '5105550001', source: 'PPC', equity_note: 'Sample data' }
      });
      made.push(lead.lead_id);
    } catch (err) {
      // An existing TEST - row is fine; createTestData is meant to be re-runnable.
    }
  });

  try {
    saveDailyMetrics_(ctx, {
      date: today,
      data: { tv_spend: 100, ppc_spend: 50, new_leads: 4, inbound_calls: 6, missed_calls: 2,
        sellers_reached: 3, appointments_set: 1, contracts_signed: 0, deals_closed: 0,
        minutes_to_first_call: 12 }
    });
  } catch (err) {
    // Today may already be logged; that is not a failure.
  }

  var summary = 'Created ' + made.length + ' test lead(s) and today\'s sample numbers in ' +
    env_() + '. All test rows are prefixed "' + TEST_PREFIX_ + '".';
  Logger.log(summary);
  return summary;
}

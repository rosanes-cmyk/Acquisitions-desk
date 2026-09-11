/**
 * Setup.js - the database schema, and the editor-run functions that build and
 * repair it (3.1-3.3, 4.9).
 *
 * setupDatabase() is idempotent: running it twice leaves an identical schema and
 * no duplicate seeds. Schema changes are ADDITIVE ONLY - new columns are appended
 * on the right, and nothing is ever reordered, renamed or deleted (3.2.1).
 */

var SHEET_NAMES_ = {
  USERS: 'USERS',
  LEADS: 'LEADS',
  LEAD_ACTIVITY: 'LEAD_ACTIVITY',
  APPOINTMENTS: 'APPOINTMENTS',
  DAILY_METRICS: 'DAILY_METRICS',
  TOOL_INVENTORY: 'TOOL_INVENTORY',
  TOOL_TRAINING: 'TOOL_TRAINING',
  TOOL_RUNS: 'TOOL_RUNS',
  PILLARS: 'PILLARS',
  BUILDER_ROLLCALL: 'BUILDER_ROLLCALL',
  SETTINGS: 'SETTINGS',
  AUDIT_LOG: 'AUDIT_LOG',
  ERROR_LOG: 'ERROR_LOG',
  BACKUP_LOG: 'BACKUP_LOG',
  TEST_RESULTS: 'TEST_RESULTS'
};

var SCHEMA_VERSION_ = 1;

/**
 * Column order below is the v1 order with the additions appended, exactly as
 * pinned in 3.3. `numbers` are real numeric cells; `booleans` are real TRUE/FALSE
 * cells; EVERY other column is formatted Plain text (@) so Sheets cannot turn
 * 2026-09-11 into a date or 5105550134 into a number (3.2.2).
 */
var SCHEMA_ = {
  USERS: {
    idColumn: 'user_id',
    headers: ['user_id', 'name', 'email', 'team', 'role', 'active', 'permission_level',
      'created_at', 'updated_at'],
    booleans: ['active'],
    numbers: []
  },

  LEADS: {
    idColumn: 'lead_id',
    headers: ['lead_id', 'address', 'seller_name', 'phone', 'source', 'equity_note', 'status',
      'assigned_to', 'team', 'flag_juan', 'compliance_mailer_check', 'contact_attempts',
      'next_action', 'due_date', 'arv', 'repairs', 'asking_price', 'offer', 'appointment_date',
      'appointment_outcome', 'archive_reason', 'created_by', 'created_at', 'updated_by',
      'updated_at', 'last_touched_at', 'version',
      // additions (3.3 "+")
      'address_normalized', 'phone_normalized', 'recent_notes_json', 'last_note_at', 'flagged_at',
      'compliance_flagged_at', 'appointment_time', 'possible_duplicate_of', 'legacy_id'],
    booleans: ['flag_juan', 'compliance_mailer_check'],
    numbers: ['contact_attempts', 'arv', 'repairs', 'asking_price', 'offer', 'version']
  },

  LEAD_ACTIVITY: {
    idColumn: 'activity_id',
    appendOnly: true,
    headers: ['activity_id', 'lead_id', 'user_id', 'user_name', 'user_email', 'business_date',
      'timestamp_utc', 'action_type', 'field_changed', 'old_value', 'new_value', 'note',
      'client_request_id'],
    booleans: [],
    numbers: []
  },

  APPOINTMENTS: {
    idColumn: 'appointment_id',
    headers: ['appointment_id', 'lead_id', 'appointment_date', 'appointment_time', 'timezone',
      'assigned_to', 'status', 'outcome', 'notes', 'created_by', 'created_at', 'updated_by',
      'updated_at'],
    booleans: [],
    numbers: []
  },

  DAILY_METRICS: {
    idColumn: 'business_date',
    headers: ['business_date', 'tv_spend', 'ppc_spend', 'ppl_spend', 'other_spend', 'new_leads',
      'inbound_calls', 'missed_calls', 'sellers_reached', 'appointments_set', 'contracts_signed',
      'contracts_fell_out', 'deals_closed', 'minutes_to_first_call', 'created_by', 'created_at',
      'updated_by', 'updated_at', 'version'],
    booleans: [],
    numbers: ['tv_spend', 'ppc_spend', 'ppl_spend', 'other_spend', 'new_leads', 'inbound_calls',
      'missed_calls', 'sellers_reached', 'appointments_set', 'contracts_signed',
      'contracts_fell_out', 'deals_closed', 'minutes_to_first_call', 'version']
  },

  TOOL_INVENTORY: {
    idColumn: 'tool_id',
    headers: ['tool_id', 'name', 'description', 'built_by', 'operator', 'backup_operator', 'status',
      'steps', 'expected_output', 'cadence', 'link', 'recommendation', 'handoff_date', 'verdict',
      'proof_last_week', 'created_at', 'updated_at',
      'asked_builder_date', 'is_seeded', 'version'],
    booleans: ['is_seeded'],
    numbers: ['version']
  },

  TOOL_TRAINING: {
    idColumn: 'record_id',
    headers: ['record_id', 'tool_id', 'user_id', 'trained', 'certified_date', 'certified_by',
      'notes', 'updated_at'],
    booleans: ['trained'],
    numbers: []
  },

  TOOL_RUNS: {
    idColumn: 'run_id',
    appendOnly: true,
    headers: ['run_id', 'tool_id', 'business_date', 'run_by', 'run_at', 'status', 'result', 'proof'],
    booleans: [],
    numbers: []
  },

  PILLARS: {
    idColumn: 'pillar_id',
    headers: ['pillar_id', 'name', 'description', 'state', 'updated_by', 'updated_at'],
    booleans: [],
    numbers: []
  },

  BUILDER_ROLLCALL: {
    idColumn: 'builder_name',
    headers: ['builder_name', 'asked_date', 'updated_by', 'updated_at'],
    booleans: [],
    numbers: []
  },

  SETTINGS: {
    idColumn: 'setting_key',
    headers: ['setting_key', 'setting_value', 'updated_by', 'updated_at'],
    booleans: [],
    numbers: []
  },

  AUDIT_LOG: {
    idColumn: 'event_id',
    appendOnly: true,
    headers: ['event_id', 'timestamp_utc', 'business_date', 'user_id', 'user_email', 'entity_type',
      'entity_id', 'action', 'details'],
    booleans: [],
    numbers: []
  },

  ERROR_LOG: {
    idColumn: 'error_id',
    appendOnly: true,
    headers: ['error_id', 'timestamp_utc', 'user_id', 'function', 'entity_type', 'entity_id',
      'error', 'details'],
    booleans: [],
    numbers: []
  },

  BACKUP_LOG: {
    idColumn: 'backup_id',
    appendOnly: true,
    headers: ['backup_id', 'timestamp', 'backup_file_id', 'backup_name', 'status', 'error'],
    booleans: [],
    numbers: []
  },

  TEST_RESULTS: {
    idColumn: 'run_id',
    appendOnly: true,
    devOnly: true,
    headers: ['run_id', 'timestamp_utc', 'tier', 'test_name', 'result', 'details'],
    booleans: [],
    numbers: []
  }
};

/** header -> 'bool' | 'number' for one sheet, for coerceForWrite_. */
function columnKinds_(sheetName) {
  var def = SCHEMA_[sheetName];
  if (!def) throw new Error('Unknown sheet: ' + sheetName);
  var kinds = {};
  def.booleans.forEach(function (header) { kinds[header] = 'bool'; });
  def.numbers.forEach(function (header) { kinds[header] = 'number'; });
  return kinds;
}

function idColumnOf_(sheetName) {
  return SCHEMA_[sheetName].idColumn;
}

/* ------------------------------------------------------------------ seeds */

/** 3.3 SETTINGS. Only missing keys are written, so admin edits are never undone. */
var SETTINGS_SEED_ = [
  ['monthly_deal_target', '3'],
  ['monthly_marketing_budget', '0'],
  ['mao_percentage', '70'],
  ['stale_lead_days', '7'],
  ['business_timezone', 'America/Los_Angeles'],
  ['auto_refresh_seconds', '30'],
  ['app_version', '1.0.0'],
  ['live_list_target', '200'],
  ['team_queues', 'MX,PH,CA'],
  ['rep_sees_all_leads', 'TRUE'],
  ['backup_retention_days', '60'],
  ['schema_version', String(SCHEMA_VERSION_)]
];

/**
 * The five pillars in prototype order (2.1). The one-line descriptions live in
 * the prototype HTML and are filled in by seedPillarDescriptions_ below once that
 * file is in the repo; a blank description never overwrites an existing one.
 */
var PILLARS_SEED_ = [
  ['lead_scoring', 'Lead scoring'],
  ['seller_outreach', 'Seller outreach'],
  ['follow_up', 'Follow-up'],
  ['contract_generation', 'Contract generation'],
  ['reporting', 'Reporting']
];

/** 2.1 - the three builders in the rollcall. */
var BUILDERS_SEED_ = ['Seth', 'Jonathan', 'Bryan'];

/**
 * The 22 BASE_TOOLS from the prototype, seeded with their prototype tool_id so
 * existing runs and training rows keep pointing at the same tool (3.2.7).
 *
 * PENDING: this array is populated from acquisitions_desk (1)(1).html, which is
 * the only place the 22 names, jobs, builders, operators and cadences exist.
 * Seeding is skipped while it is empty - setupDatabase() reports that, and
 * re-running it after the array is filled seeds them without touching anything
 * else (skip-existing by tool_id).
 */
var BASE_TOOLS_SEED_ = [];

/**
 * G2 default: every name from the v1 list and the prototype list, seeded
 * INACTIVE with a blank email and permission_level "needs_email". Emails are
 * never invented. Role defaults to REP - the least privilege - and an admin sets
 * the real role in the Admin tab.
 *
 * "Sales manager" and "Mexico team" are deliberately absent: the first is a role,
 * the second is a team queue (TEAM:MX), not a person. Tool operators Christine,
 * Danny and MC are not app users and stay as free text on the tool record (2.1).
 */
var USERS_SEED_NAMES_ = ['Juan', 'David', 'Diego', 'Era', 'Barbie', 'Thea', 'Cherry', 'Genesis',
  'Jonathan', 'Seth', 'Bryan'];

/* -------------------------------------------------------- setupDatabase() */

/**
 * GUARDED EDITOR-RUN ENTRY POINT (4.2.3). Idempotent and non-destructive.
 *
 * Creates or repairs the database for THIS environment: every sheet, exact
 * headers, plain-text formats, frozen and protected header row, and the seed
 * rows. Existing data is never rewritten.
 */
function setupDatabase() {
  var caller = requireAdminOrBootstrap_();
  var spreadsheet = openOrCreateDatabase_();
  var report = ['Database: ' + spreadsheet.getName() + ' (' + spreadsheet.getId() + ')',
    'Environment: ' + env_()];

  var created = [];
  var columnsAdded = [];

  for (var name in SCHEMA_) {
    if (!Object.prototype.hasOwnProperty.call(SCHEMA_, name)) continue;
    var def = SCHEMA_[name];
    if (def.devOnly && !isDev_()) continue;
    var result = ensureSheet_(spreadsheet, name, def);
    if (result.created) created.push(name);
    if (result.addedColumns.length) {
      columnsAdded.push(name + ': ' + result.addedColumns.join(', '));
    }
  }

  clearSchemaCache_();
  invalidateSettingsCache_();

  report.push('Sheets created: ' + (created.length ? created.join(', ') : 'none (all present)'));
  report.push('Columns appended: ' + (columnsAdded.length ? columnsAdded.join(' | ') : 'none'));
  report.push(seedSettings_());
  report.push(seedPillars_());
  report.push(seedBuilders_());
  report.push(seedBaseTools_());
  report.push(seedUsers_(caller.email, caller.bootstrap));

  setSetting_('schema_version', String(SCHEMA_VERSION_), 'SYSTEM_SETUP');
  invalidateSettingsCache_();

  auditSafely_('', caller.email, 'SETUP_RUN', 'system', spreadsheet.getId(), report.join(' | '));

  var summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * ADMIN guard with a first-run exception.
 *
 * Before anyone is provisioned there is no ADMIN to authorize against, and the
 * app denies every user anyway (getCurrentUser_ refuses an email that is not in
 * USERS), so nobody can reach the desk during that window. Only someone with
 * edit access to the script project can run this. Once an active ADMIN exists,
 * the ordinary guard applies and a rep calling it from the browser is refused.
 */
function requireAdminOrBootstrap_() {
  var email = activeUserEmail_();
  if (!email) {
    throw accessError_('IDENTITY_UNAVAILABLE',
      'Google returned no account for this session. Run this from the Apps Script editor while ' +
      'signed in with the company account.');
  }
  if (hasActiveAdmin_()) {
    var ctx = requireRole_(ROLE_ADMIN_);
    return { email: ctx.email, bootstrap: false };
  }
  return { email: email, bootstrap: true };
}

/** Tolerates a database that does not exist yet - that IS the bootstrap case. */
function hasActiveAdmin_() {
  try {
    var users = readAll_(SHEET_NAMES_.USERS);
    for (var i = 0; i < users.length; i++) {
      if (toBool_(users[i].active) && normalizeRole_(users[i].role) === ROLE_ADMIN_ &&
        normalizeEmail_(users[i].email)) {
        return true;
      }
    }
    return false;
  } catch (err) {
    return false;
  }
}

function openOrCreateDatabase_() {
  var existingId = getProp_(PROP_DB_ID_);
  if (existingId) return SpreadsheetApp.openById(existingId);

  var name = isDev_()
    ? 'THB Acquisitions Desk — DEV Database'
    : 'THB Acquisitions Desk — Production Database';
  var created = SpreadsheetApp.create(name);
  setProp_(PROP_DB_ID_, created.getId());
  return created;
}

/**
 * Creates the sheet if missing, appends any missing columns on the RIGHT, applies
 * plain-text formats, freezes and protects row 1. Additive only (3.2.1).
 * @return {{created: boolean, addedColumns: !Array<string>}}
 */
function ensureSheet_(spreadsheet, name, def) {
  var sheet = spreadsheet.getSheetByName(name);
  var created = false;

  if (!sheet) {
    // Reuse the empty default sheet the first time rather than leaving it behind.
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0 &&
      /^Sheet1$|^Sheet 1$/.test(sheets[0].getName())) {
      sheet = sheets[0].setName(name);
    } else {
      sheet = spreadsheet.insertSheet(name);
    }
    created = true;
  }

  var existing = headersOf_(sheet);
  var addedColumns = [];
  var target = existing.slice();

  for (var i = 0; i < def.headers.length; i++) {
    if (target.indexOf(def.headers[i]) < 0) {
      target.push(def.headers[i]);
      addedColumns.push(def.headers[i]);
    }
  }

  if (addedColumns.length || !existing.length) {
    if (sheet.getMaxColumns() < target.length) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), target.length - sheet.getMaxColumns());
    }
    sheet.getRange(1, 1, 1, target.length).setValues([target]).setFontWeight('bold');
  }

  applyColumnFormats_(sheet, target, def);

  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
  protectHeaderRow_(sheet, target.length);

  return { created: created, addedColumns: addedColumns };
}

/**
 * Plain text (@) on every column that is not a number or a boolean, so ids,
 * dates, timestamps and phone numbers survive exactly as written (3.2.2).
 */
function applyColumnFormats_(sheet, headers, def) {
  var rows = Math.max(sheet.getMaxRows() - 1, 1);
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    var isNumber = def.numbers.indexOf(header) >= 0;
    var isBoolean = def.booleans.indexOf(header) >= 0;
    if (isNumber || isBoolean) continue;
    sheet.getRange(2, i + 1, rows, 1).setNumberFormat('@');
  }
}

/**
 * Warning-only protection on row 1.
 *
 * Deliberate: a hard protection is owned by whoever created it, which would stop
 * a second admin from running setupDatabase() to add a column. The real defence
 * is that reps and managers have no access to the spreadsheet at all (3.2.9);
 * this guards an admin's stray edit.
 */
function protectHeaderRow_(sheet, width) {
  var description = 'THB header row - do not edit by hand';
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getDescription() === description) return;
  }
  sheet.getRange(1, 1, 1, width).protect()
    .setDescription(description)
    .setWarningOnly(true);
}

/* ------------------------------------------------------------ seed writers */

function seedSettings_() {
  var existing = {};
  readAll_(SHEET_NAMES_.SETTINGS).forEach(function (row) {
    existing[String(row.setting_key || '').trim()] = true;
  });

  var now = nowIsoUtc_();
  var toAdd = SETTINGS_SEED_
    .filter(function (pair) { return !existing[pair[0]]; })
    .map(function (pair) {
      return { setting_key: pair[0], setting_value: pair[1], updated_by: 'SYSTEM_SETUP',
        updated_at: now };
    });

  appendRows_(SHEET_NAMES_.SETTINGS, toAdd, columnKinds_(SHEET_NAMES_.SETTINGS));
  return 'Settings seeded: ' + (toAdd.length || 'none missing');
}

function seedPillars_() {
  var existing = {};
  readAll_(SHEET_NAMES_.PILLARS).forEach(function (row) {
    existing[String(row.pillar_id || '')] = true;
  });

  var now = nowIsoUtc_();
  var toAdd = PILLARS_SEED_
    .filter(function (pair) { return !existing[pair[0]]; })
    .map(function (pair) {
      return { pillar_id: pair[0], name: pair[1], description: '', state: PILLAR_STATES_[0],
        updated_by: 'SYSTEM_SETUP', updated_at: now };
    });

  appendRows_(SHEET_NAMES_.PILLARS, toAdd, columnKinds_(SHEET_NAMES_.PILLARS));
  return 'Pillars seeded: ' + (toAdd.length || 'none missing');
}

function seedBuilders_() {
  var existing = {};
  readAll_(SHEET_NAMES_.BUILDER_ROLLCALL).forEach(function (row) {
    existing[String(row.builder_name || '')] = true;
  });

  var now = nowIsoUtc_();
  var toAdd = BUILDERS_SEED_
    .filter(function (builder) { return !existing[builder]; })
    .map(function (builder) {
      return { builder_name: builder, asked_date: '', updated_by: 'SYSTEM_SETUP', updated_at: now };
    });

  appendRows_(SHEET_NAMES_.BUILDER_ROLLCALL, toAdd, columnKinds_(SHEET_NAMES_.BUILDER_ROLLCALL));
  return 'Builders seeded: ' + (toAdd.length || 'none missing');
}

/** Skip-existing by tool_id, so re-running never duplicates or overwrites a tool. */
function seedBaseTools_() {
  if (!BASE_TOOLS_SEED_.length) {
    return 'Base tools seeded: SKIPPED - BASE_TOOLS_SEED_ is still empty. It is filled from the ' +
      'prototype HTML; re-run setupDatabase() afterwards.';
  }

  var existing = {};
  readAll_(SHEET_NAMES_.TOOL_INVENTORY).forEach(function (row) {
    existing[String(row.tool_id || '')] = true;
  });

  var now = nowIsoUtc_();
  var toAdd = BASE_TOOLS_SEED_
    .filter(function (tool) { return !existing[tool.tool_id]; })
    .map(function (tool) {
      return {
        tool_id: tool.tool_id,
        name: tool.name,
        description: tool.description || '',
        built_by: tool.built_by || '',
        operator: tool.operator || '',
        backup_operator: '',
        status: TOOL_STATUSES_[0],            // Unconfirmed
        steps: '',
        expected_output: '',
        cadence: tool.cadence || CADENCES_[0],
        link: '',
        recommendation: TOOL_RECOMMENDATIONS_[0], // Decide
        handoff_date: '',
        verdict: VERDICTS_[0],                // Not handed over yet
        proof_last_week: '',
        created_at: now,
        updated_at: now,
        asked_builder_date: '',
        is_seeded: true,
        version: 1
      };
    });

  appendRows_(SHEET_NAMES_.TOOL_INVENTORY, toAdd, columnKinds_(SHEET_NAMES_.TOOL_INVENTORY));
  return 'Base tools seeded: ' + (toAdd.length || 'none missing');
}

/** G2 default. Never invents an email; only the deploying account is active. */
function seedUsers_(deployerEmail, isBootstrap) {
  var users = readAll_(SHEET_NAMES_.USERS);
  var byName = {};
  var byEmail = {};
  users.forEach(function (row) {
    byName[String(row.name || '').trim().toLowerCase()] = row;
    var email = normalizeEmail_(row.email);
    if (email) byEmail[email] = row;
  });

  var now = nowIsoUtc_();
  var kinds = columnKinds_(SHEET_NAMES_.USERS);
  var toAdd = [];

  USERS_SEED_NAMES_.forEach(function (name) {
    if (byName[name.toLowerCase()]) return;
    toAdd.push({
      user_id: newUniqueId_(ID_PREFIX_.USER, compactStamp_(now)),
      name: name,
      email: '',
      team: '',
      role: ROLE_REP_,
      active: false,
      permission_level: 'needs_email',
      created_at: now,
      updated_at: now
    });
  });

  var deployerNote = 'already present';
  if (deployerEmail && !byEmail[deployerEmail]) {
    toAdd.push({
      user_id: newUniqueId_(ID_PREFIX_.USER, compactStamp_(now)),
      name: provisionalNameFromEmail_(deployerEmail),
      email: deployerEmail,
      team: '',
      role: ROLE_ADMIN_,
      active: true,
      permission_level: isBootstrap ? 'bootstrap_admin' : '',
      created_at: now,
      updated_at: now
    });
    deployerNote = 'added as active ADMIN';
  }

  appendRows_(SHEET_NAMES_.USERS, toAdd, kinds);
  return 'Users seeded: ' + toAdd.length + ' row(s); deploying account ' + deployerEmail +
    ' ' + deployerNote + '. Placeholders are INACTIVE with no email until an admin sets them.';
}

/** A stand-in until an admin types the real name; Google gives us only an email. */
function provisionalNameFromEmail_(email) {
  var local = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return local.replace(/\b[a-z]/g, function (ch) { return ch.toUpperCase(); }) || email;
}

/** Upsert one SETTINGS row. Used by setup and by the Admin tab (AdminService). */
function setSetting_(key, value, byUserId) {
  var found = findRowById_(SHEET_NAMES_.SETTINGS, 'setting_key', key);
  var now = nowIsoUtc_();
  if (found) {
    writeRowCells_(SHEET_NAMES_.SETTINGS, found.rowIndex,
      { setting_value: String(value), updated_by: byUserId || '', updated_at: now },
      columnKinds_(SHEET_NAMES_.SETTINGS));
  } else {
    appendRow_(SHEET_NAMES_.SETTINGS,
      { setting_key: key, setting_value: String(value), updated_by: byUserId || '',
        updated_at: now },
      columnKinds_(SHEET_NAMES_.SETTINGS));
  }
  invalidateSettingsCache_();
}

/* ------------------------------------------------------- installTriggers() */

/**
 * GUARDED EDITOR-RUN ENTRY POINT (4.2.3). Idempotent.
 *
 * Installs the daily backup trigger around 02:00 business time. The trigger is
 * owned by the account that runs this, so recovery never depends on one person's
 * spreadsheet staying healthy (4.12).
 */
function installTriggers() {
  var ctx = requireRole_(ROLE_ADMIN_);
  var handler = 'createDatabaseBackup';

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handler) {
      var message = 'Daily backup trigger already installed. Nothing to do.';
      Logger.log(message);
      return message;
    }
  }

  ScriptApp.newTrigger(handler).timeBased().atHour(2).everyDays(1).create();
  auditSafely_(ctx.user_id, ctx.email, 'TRIGGER_INSTALLED', 'system', handler,
    'Daily backup trigger installed for ~02:00 ' + businessTimezone_() + '.');

  var installed = 'Daily backup trigger installed (~02:00 ' + businessTimezone_() + '), owned by ' +
    ctx.email + '.';
  Logger.log(installed);
  return installed;
}

/**
 * Validate.js - enumerations, validators, field whitelists, normalizers, envelopes.
 *
 * PURE FILE (4.1). Loaded after Dates.js; it uses that file's date predicates.
 *
 * Every enumeration here is copied verbatim from the prototype (2.1). Nothing in
 * this file may invent a label: the team's existing workflow language is the spec.
 */

/* ------------------------------------------------------------------ statuses */

var STATUS_ = {
  NEW: 'NEW',
  INVESTIGATING: 'INVESTIGATING',
  CONTACT_MADE: 'CONTACT_MADE',
  APPOINTMENT_SET: 'APPOINTMENT_SET',
  UNDER_CONTRACT: 'UNDER_CONTRACT',
  CLOSED: 'CLOSED',
  ARCHIVED_SOLD: 'ARCHIVED_SOLD',
  ARCHIVED_NO_EQUITY: 'ARCHIVED_NO_EQUITY',
  ARCHIVED_NOT_INTERESTED: 'ARCHIVED_NOT_INTERESTED',
  ARCHIVED_BAD_DATA: 'ARCHIVED_BAD_DATA'
};

/** LIVE = the first five. CLOSED is not live, and is not archived either (2.1). */
var LIVE_STATUSES_ = [
  STATUS_.NEW, STATUS_.INVESTIGATING, STATUS_.CONTACT_MADE,
  STATUS_.APPOINTMENT_SET, STATUS_.UNDER_CONTRACT
];

var ARCHIVED_STATUSES_ = [
  STATUS_.ARCHIVED_SOLD, STATUS_.ARCHIVED_NO_EQUITY,
  STATUS_.ARCHIVED_NOT_INTERESTED, STATUS_.ARCHIVED_BAD_DATA
];

var ALL_STATUSES_ = LIVE_STATUSES_.concat([STATUS_.CLOSED], ARCHIVED_STATUSES_);

/** Internal ids are the constants; the UI shows these labels (2.1). */
var STATUS_LABELS_ = {
  NEW: 'New',
  INVESTIGATING: 'Investigating',
  CONTACT_MADE: 'Contact made',
  APPOINTMENT_SET: 'Appointment set',
  UNDER_CONTRACT: 'Under contract',
  CLOSED: 'Closed',
  ARCHIVED_SOLD: 'Archived: sold',
  ARCHIVED_NO_EQUITY: 'Archived: no equity',
  ARCHIVED_NOT_INTERESTED: 'Archived: not interested',
  ARCHIVED_BAD_DATA: 'Archived: bad data'
};

/** archive_reason is set from the status, never sent by the client (3.3). */
var ARCHIVE_REASONS_ = {
  ARCHIVED_SOLD: 'sold',
  ARCHIVED_NO_EQUITY: 'no equity',
  ARCHIVED_NOT_INTERESTED: 'not interested',
  ARCHIVED_BAD_DATA: 'bad data'
};

/* -------------------------------------------------- prototype enumerations */

/** 7 including the blank first option. */
var APPOINTMENT_OUTCOMES_ = ['', 'Not visited yet', 'Offer made', 'Thinking about it',
  'Too high on price', 'No deal', 'Signed'];

var TOOL_STATUSES_ = ['Unconfirmed', 'Live and used daily', 'Live but nobody uses it',
  'Built, never launched', 'Waiting on legal clearance', 'Retired'];

var TOOL_RECOMMENDATIONS_ = ['Decide', 'Use it daily', 'Wire it into the desk',
  'Wrong lane, leave it', 'Retire it'];

var CADENCES_ = ['Not set', 'Every day', 'Every weekday', 'Weekly', 'On each new lead', 'As needed'];

/** The Today tab's "tools that have to run today" list (2.1). */
var DAILY_CADENCES_ = ['Every day', 'Every weekday'];

var VERDICTS_ = ['Not handed over yet', 'Works, in use', 'Broken, sent back', 'Needs training first'];

var PILLAR_STATES_ = ['Not started', 'Built, not in use', 'Partly running', 'Running every day'];

var CHANNELS_ = ['TV', 'PPC', 'PPL', 'Other'];

var ROLES_ = ['ADMIN', 'MANAGER', 'REP', 'TECHNICAL'];
var RUN_STATUSES_ = ['DONE', 'VOIDED'];
var APPOINTMENT_STATUSES_ = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'];

/* ---------------------------------------------------------- error envelope */

var ERROR_CODES_ = ['IDENTITY_UNAVAILABLE', 'ACCESS_DENIED', 'VALIDATION_ERROR', 'NOT_FOUND',
  'CONFLICT_RECORD_CHANGED', 'LOCK_TIMEOUT', 'DUPLICATE', 'SERVER_ERROR'];

/** Verbatim, per 4.5. */
var CONFLICT_MESSAGE_ =
  'This lead was updated by another team member. Review the latest information before saving your change.';

/* ---------------------------------------------------------- field policies */

var MAX_LENGTHS_ = {
  address: 200,
  seller_name: 120,
  phone: 40,
  source: 40,
  next_action: 300,
  equity_note: 2000,
  note: 2000,
  steps: 2000,
  description: 2000,
  expected_output: 2000,
  proof_last_week: 2000,
  link: 500,
  name: 120,
  email: 200
};

/** The only fields updateLead accepts (4.6). Everything else has its own action. */
var UPDATE_LEAD_FIELDS_ = ['status', 'arv', 'repairs', 'asking_price', 'offer',
  'appointment_date', 'appointment_time', 'appointment_outcome', 'seller_name', 'phone',
  'source', 'equity_note', 'address'];

/** One route per field - no field is reachable two ways (4.6). */
var LEAD_FIELD_ROUTES_ = {
  assigned_to: 'assignLead',
  next_action: 'setNextAction',
  due_date: 'setNextAction',
  flag_juan: 'setJuanFlag',
  compliance_mailer_check: 'setComplianceFlag',
  contact_attempts: 'logAttempt',
  notes: 'addLeadNote',
  note: 'addLeadNote'
};

/** Server-owned. A client may never write these, whatever the action (4.6). */
var SERVER_OWNED_FIELDS_ = ['lead_id', 'version', 'created_by', 'created_at', 'updated_by',
  'updated_at', 'last_touched_at', 'last_note_at', 'recent_notes_json', 'archive_reason',
  'address_normalized', 'phone_normalized', 'flagged_at', 'compliance_flagged_at',
  'possible_duplicate_of', 'legacy_id', 'team', 'contact_attempts'];

var NUMERIC_LEAD_FIELDS_ = ['arv', 'repairs', 'asking_price', 'offer'];

var BULK_IMPORT_MAX_ROWS_ = 200;

/* ------------------------------------------------------------ small helpers */

function isBlank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function trimString_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/** Trim + collapse every run of whitespace to one space. */
function normalizeWhitespace_(value) {
  return trimString_(value).replace(/\s+/g, ' ');
}

/** Sheets gives back TRUE/true/1/'TRUE'; normalize on read (3.2.4). */
function toBool_(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  var s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/**
 * Blank means "not entered" and is NOT zero (3.2.5). Returns null for blank so
 * every downstream average, sum and render can tell the two apart.
 */
function toNumberOrNull_(value) {
  if (isBlank_(value)) return null;
  var n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : null;
}

/* ------------------------------------------------------------- validation */

/**
 * A validation failure that api() turns into a VALIDATION_ERROR envelope naming
 * the field (4.6). Carries `field` so the client can mark the right control.
 */
function validationError_(field, message) {
  var err = new Error(message);
  err.name = 'ValidationError';
  err.code = 'VALIDATION_ERROR';
  err.field = field;
  return err;
}

function isValidationError_(err) {
  return !!err && err.code === 'VALIDATION_ERROR';
}

function requireEnum_(field, value, allowed) {
  var v = value === null || value === undefined ? '' : String(value);
  for (var i = 0; i < allowed.length; i++) {
    if (allowed[i] === v) return v;
  }
  throw validationError_(field, 'Not an allowed value for ' + field + ': "' + v + '".');
}

function requireIsoDate_(field, value, optional) {
  if (isBlank_(value)) {
    if (optional) return '';
    throw validationError_(field, field + ' is required (yyyy-MM-dd).');
  }
  var v = trimString_(value);
  if (!isIsoDate_(v)) throw validationError_(field, field + ' must be a real date as yyyy-MM-dd.');
  return v;
}

function requireHhMm_(field, value, optional) {
  if (isBlank_(value)) {
    if (optional) return '';
    throw validationError_(field, field + ' is required (HH:mm).');
  }
  var v = trimString_(value);
  if (!isHhMm_(v)) throw validationError_(field, field + ' must be a time as HH:mm.');
  return v;
}

/** Finite and >= 0, or null when blank. Blank stays blank (3.2.5). */
function requireNonNegativeNumberOrBlank_(field, value) {
  if (isBlank_(value)) return null;
  var n = toNumberOrNull_(value);
  if (n === null || !isFinite(n)) throw validationError_(field, field + ' must be a number.');
  if (n < 0) throw validationError_(field, field + ' cannot be negative.');
  return n;
}

function requireBoolean_(field, value) {
  if (value === true || value === false) return value;
  throw validationError_(field, field + ' must be true or false.');
}

function requireText_(field, value, options) {
  var opts = options || {};
  var v = opts.collapse === false ? trimString_(value) : normalizeWhitespace_(value);
  if (!v && opts.required) throw validationError_(field, field + ' is required.');
  var max = opts.max || MAX_LENGTHS_[field];
  if (max && v.length > max) {
    throw validationError_(field, field + ' is longer than ' + max + ' characters.');
  }
  return v;
}

/**
 * http(s) only. The prototype accepted any string, which allowed javascript: URLs
 * (finding C7 / 2.2 "must NOT port" #6).
 * @return {{ok: boolean, value: string}} ok=false -> render as plain text with "invalid link"
 */
function validateHttpLink_(value) {
  var v = trimString_(value);
  if (!v) return { ok: true, value: '' };
  if (v.length > MAX_LENGTHS_.link) return { ok: false, value: v };
  return { ok: /^https?:\/\/[^\s<>"']+$/i.test(v), value: v };
}

function requireHttpLink_(field, value) {
  var checked = validateHttpLink_(value);
  if (!checked.ok) {
    throw validationError_(field, field + ' must start with http:// or https://.');
  }
  return checked.value;
}

/**
 * Rejects unknown and server-owned fields instead of ignoring them, so a client
 * bug surfaces as an error rather than as a silent no-op.
 * @return {{clean: !Object, rejected: !Array<string>, routed: !Array<string>}}
 */
function pickWhitelisted_(patch, allowedFields) {
  var clean = {};
  var rejected = [];
  var routed = [];
  var source = patch || {};
  for (var key in source) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (allowedFields.indexOf(key) >= 0) {
      clean[key] = source[key];
    } else if (LEAD_FIELD_ROUTES_[key]) {
      routed.push(key);
    } else {
      rejected.push(key);
    }
  }
  return { clean: clean, rejected: rejected, routed: routed };
}

/** The action that owns a field, for the "use the dedicated action" error text. */
function routeForField_(field) {
  return LEAD_FIELD_ROUTES_[field] || '';
}

function isLiveStatus_(status) { return LIVE_STATUSES_.indexOf(status) >= 0; }
function isArchivedStatus_(status) { return ARCHIVED_STATUSES_.indexOf(status) >= 0; }

/**
 * Status transition rules (4.6). `action` matters because archive and restore are
 * separate actions - updateLead may not move a lead into or out of an archive.
 * @param {string} from
 * @param {string} to
 * @param {string} action one of updateLead | archiveLead | restoreLead
 */
function canTransitionStatus_(from, to, action) {
  if (ALL_STATUSES_.indexOf(to) < 0) return false;
  if (action === 'archiveLead') {
    // live or CLOSED -> any ARCHIVED_*
    return isArchivedStatus_(to) && (isLiveStatus_(from) || from === STATUS_.CLOSED);
  }
  if (action === 'restoreLead') {
    // ARCHIVED_* -> a live status only
    return isArchivedStatus_(from) && isLiveStatus_(to);
  }
  // updateLead: live <-> live, and live -> CLOSED. Never in or out of an archive.
  if (isArchivedStatus_(from) || isArchivedStatus_(to)) return false;
  if (isLiveStatus_(from) && (isLiveStatus_(to) || to === STATUS_.CLOSED)) return true;
  // CLOSED may be reopened to a live status by an ordinary edit.
  return from === STATUS_.CLOSED && isLiveStatus_(to);
}

/* ---------------------------------------------------------- normalization */

/** Street-suffix forms normalized to one spelling so duplicates match (6.7). */
var ADDRESS_SUFFIXES_ = {
  STREET: 'ST', ST: 'ST',
  AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE',
  ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DR: 'DR',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  LANE: 'LN', LN: 'LN',
  COURT: 'CT', CT: 'CT'
};

/**
 * Upper-case, punctuation stripped, whitespace collapsed, suffixes normalized (6.7).
 * '123 N. Main Street, Apt 2' and '123 n main st apt 2' collide, as they should.
 */
function normalizeAddress_(value) {
  var upper = trimString_(value).toUpperCase().replace(/[^A-Z0-9\s]/g, ' ');
  var tokens = upper.split(/\s+/);
  var out = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (!t) continue;
    out.push(Object.prototype.hasOwnProperty.call(ADDRESS_SUFFIXES_, t) ? ADDRESS_SUFFIXES_[t] : t);
  }
  return out.join(' ');
}

/** Digits only, last 10 (6.7). '+1 (510) 555-0134' and '5105550134' collide. */
function normalizePhone_(value) {
  var digits = trimString_(value).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Lower-cased and trimmed, per 3.3 USERS. */
function normalizeEmail_(value) {
  return trimString_(value).toLowerCase();
}

/* ------------------------------------------------------- bulk lead parsing */

/**
 * Parses the Add-leads textarea (5.8). One lead per line.
 *
 * - Delimiter auto-detected: tab when any line has one (pasted from a spreadsheet),
 *   otherwise comma.
 * - A first line whose first cell is "address" is a header and is skipped.
 * - Positional: address, seller, phone, source, equity note. Extra cells join
 *   into the equity note - nothing is silently discarded.
 * - Every field is trimmed and its whitespace collapsed.
 * - `line` is the 1-based line number IN THE ORIGINAL TEXT so failures can be
 *   reported against what the user is looking at.
 *
 * @return {{rows: !Array<!Object>, delimiter: string, headerSkipped: boolean}}
 */
function parseLeadLines_(text) {
  var raw = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  var delimiter = raw.join('\n').indexOf('\t') >= 0 ? '\t' : ',';
  var rows = [];
  var headerSkipped = false;
  var seenFirstContentLine = false;

  for (var i = 0; i < raw.length; i++) {
    var line = raw[i];
    if (trimString_(line) === '') continue;

    var cells = line.split(delimiter);
    var first = normalizeWhitespace_(cells[0]).toLowerCase();

    if (!seenFirstContentLine) {
      seenFirstContentLine = true;
      if (first === 'address') { headerSkipped = true; continue; }
    }

    var extras = [];
    for (var c = 5; c < cells.length; c++) {
      var extra = normalizeWhitespace_(cells[c]);
      if (extra) extras.push(extra);
    }
    var equity = normalizeWhitespace_(cells[4]);
    if (extras.length) equity = equity ? equity + ' ' + extras.join(' ') : extras.join(' ');

    rows.push({
      line: i + 1,
      address: normalizeWhitespace_(cells[0]),
      seller_name: normalizeWhitespace_(cells[1]),
      phone: normalizeWhitespace_(cells[2]),
      source: normalizeWhitespace_(cells[3]),
      equity_note: equity
    });
  }

  return { rows: rows, delimiter: delimiter, headerSkipped: headerSkipped };
}

/* ------------------------------------------------------------- envelopes */

/** { ok: true, data, message?, changeStamp, serverTimeUtc } (4.4) */
function okEnvelope_(data, meta) {
  var m = meta || {};
  var envelope = {
    ok: true,
    data: data === undefined ? null : data,
    changeStamp: m.changeStamp === undefined ? '' : m.changeStamp,
    serverTimeUtc: m.serverTimeUtc === undefined ? '' : m.serverTimeUtc
  };
  if (m.message) envelope.message = m.message;
  return envelope;
}

/** { ok: false, code, message, data? } (4.4) */
function errEnvelope_(code, message, data) {
  var safeCode = ERROR_CODES_.indexOf(code) >= 0 ? code : 'SERVER_ERROR';
  var envelope = { ok: false, code: safeCode, message: String(message || 'Something went wrong.') };
  if (data !== undefined && data !== null) envelope.data = data;
  return envelope;
}

/** NOT_FOUND - the record does not exist (4.6 "unknown IDs"). */
function notFoundError_(what, id) {
  var err = new Error('That ' + what + ' no longer exists. Refresh the desk.');
  err.code = 'NOT_FOUND';
  err.entityId = String(id || '');
  return err;
}

/**
 * CONFLICT_RECORD_CHANGED - somebody else saved first (4.5 step 3). Carries the
 * latest record so the client can show what it now says before retrying.
 */
function conflictError_(latestRecord) {
  var err = new Error(CONFLICT_MESSAGE_);
  err.code = 'CONFLICT_RECORD_CHANGED';
  err.data = latestRecord;
  return err;
}

/** DUPLICATE - an exact duplicate was refused (6.7). */
function duplicateError_(message, data) {
  var err = new Error(message);
  err.code = 'DUPLICATE';
  err.data = data;
  return err;
}

/**
 * Db.js - the only code that touches the spreadsheet.
 *
 * NOT a pure file. Everything here ends in "_" so none of it is reachable from
 * the browser (4.2): a client-callable DB helper would be a generic write-any-row
 * hole straight through the authorization model.
 *
 * Two habits this file exists to enforce (3.2, 4.5, 4.7):
 *   - Columns are located BY HEADER NAME at runtime, never by a fixed index, so
 *     appending a column on the right can never shift a write onto the wrong one.
 *   - Writes touch one row. Never load-all -> modify -> rewrite-all.
 */

var PROP_ENV_ = 'ENV';
var PROP_DB_ID_ = 'DB_SPREADSHEET_ID';
var PROP_BACKUP_FOLDER_ = 'BACKUP_FOLDER_ID';
var PROP_CHANGE_STAMP_ = 'CHANGE_STAMP';

var LOCK_TIMEOUT_MS_ = 15000;
var CACHE_TTL_SECONDS_ = 60;

/* --------------------------------------------------------- script properties */

function props_() {
  return PropertiesService.getScriptProperties();
}

function getProp_(key, fallback) {
  var value = props_().getProperty(key);
  return value === null || value === undefined || value === '' ? (fallback || '') : value;
}

function setProp_(key, value) {
  props_().setProperty(key, String(value));
}

/** 'DEV' or 'PROD'. Set per project - Script Properties are not shared (8.2). */
function env_() {
  return (getProp_(PROP_ENV_, 'DEV') || 'DEV').toUpperCase();
}

function isDev_() {
  return env_() === 'DEV';
}

/** Guards the DEV-only entry points so they can never touch production data. */
function requireDev_(what) {
  if (!isDev_()) {
    throw new Error(what + ' runs only when ENV is DEV. This project is ' + env_() + '.');
  }
}

/* ------------------------------------------------------------- spreadsheet */

/**
 * Never SpreadsheetApp.getActiveSpreadsheet() - a web app has no active
 * spreadsheet, and hard-coding an id would tie DEV to the PROD database (4.1).
 */
function openDb_() {
  var id = getProp_(PROP_DB_ID_);
  if (!id) {
    throw new Error(
      'Script Property ' + PROP_DB_ID_ + ' is not set. Run setupDatabase() from the editor first ' +
      '(RUNBOOK.md, "First run").'
    );
  }
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var found = openDb_().getSheetByName(name);
  if (!found) {
    throw new Error('Sheet "' + name + '" is missing. Run setupDatabase() to repair the schema.');
  }
  return found;
}

function cache_() {
  return CacheService.getScriptCache();
}

/** setupDatabase() calls this after any schema change so no stale map survives. */
function clearSchemaCache_() {
  try {
    cache_().removeAll(['settings:' + getProp_(PROP_DB_ID_)]);
  } catch (ignored) {
    // A cache miss is always safe; the sheet remains the source of truth.
  }
}

/* -------------------------------------------------------------- header maps */

/**
 * header name -> 0-based column index, read from row 1 at runtime (3.2.1).
 *
 * Deliberately NOT cached. 4.7 permits caching header maps, but a stale map
 * points a write at the wrong column, and reading one row is cheap next to that
 * risk. SETTINGS is cached instead, where a stale read costs nothing.
 */
function headerMap_(sheet) {
  var headers = headersOf_(sheet);
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] !== '') map[headers[i]] = i;
  }
  return map;
}

function headersOf_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (value) {
    return String(value == null ? '' : value).trim();
  });
}

/** Fails loudly rather than writing into whatever column happens to be there. */
function columnIndex_(map, header, sheetName) {
  if (!Object.prototype.hasOwnProperty.call(map, header)) {
    throw new Error(
      'Column "' + header + '" is missing from ' + sheetName + '. Run setupDatabase() to repair it.'
    );
  }
  return map[header];
}

/* ------------------------------------------------------------ value coercion */

/**
 * Sheets can hand back a Date even from a plain-text column if someone edited the
 * sheet by hand. Nothing downstream may see a Date: google.script.run cannot
 * carry one (B4 / 3.2.3), so it becomes ISO text right here at the boundary.
 */
function normalizeCellValue_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return value;
}

function rowToObject_(headers, row) {
  var record = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i] === '') continue;
    record[headers[i]] = normalizeCellValue_(row[i]);
  }
  return record;
}

/**
 * Prepares one value for a cell: real booleans stay booleans, real numbers stay
 * numbers, blanks stay blank, and everything else is written as text (3.2.2-5).
 */
function coerceForWrite_(value, kind) {
  if (value === null || value === undefined) return '';
  if (kind === 'bool') return value === true || value === 'TRUE' || value === 'true' || value === 1;
  if (kind === 'number') {
    if (value === '') return '';
    var n = typeof value === 'number' ? value : Number(value);
    return isFinite(n) ? n : '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return value.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  return String(value);
}

/* ------------------------------------------------------------------- reads */

/** Whole-sheet read as objects. Only for sheets that stay small, never activity. */
function readAll_(sheetName) {
  var target = sheet_(sheetName);
  var lastRow = target.getLastRow();
  if (lastRow < 2) return [];
  var headers = headersOf_(target);
  var values = target.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var records = [];
  for (var i = 0; i < values.length; i++) {
    records.push(rowToObject_(headers, values[i]));
  }
  return records;
}

/** One column, as strings. Used to build id indexes without reading whole rows. */
function readColumnValues_(sheet, header) {
  var map = headerMap_(sheet);
  var index = columnIndex_(map, header, sheet.getName());
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, index + 1, lastRow - 1, 1).getValues().map(function (row) {
    return String(normalizeCellValue_(row[0]));
  });
}

/**
 * id -> 1-based sheet row. Built once per request from a single column read, so
 * a request never scans 8,000 rows more than once (4.7).
 */
function idIndex_(sheet, idHeader) {
  var values = readColumnValues_(sheet, idHeader);
  var index = {};
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== '') index[values[i]] = i + 2;
  }
  return index;
}

/**
 * Reads ONE record by its permanent id (4.5 step 2).
 * @return {?{rowIndex: number, headers: !Array<string>, record: !Object}}
 */
function findRowById_(sheetName, idHeader, id) {
  var target = sheet_(sheetName);
  var wanted = String(id == null ? '' : id);
  if (!wanted) return null;

  var index = idIndex_(target, idHeader);
  var rowIndex = index[wanted];
  if (!rowIndex) return null;

  var headers = headersOf_(target);
  var values = target.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  return { rowIndex: rowIndex, headers: headers, record: rowToObject_(headers, values) };
}

function rowExists_(sheetName, idHeader, id) {
  return findRowById_(sheetName, idHeader, id) !== null;
}

/* ------------------------------------------------------------------ writes */

/**
 * Writes only the cells that changed, as one setValues over the smallest
 * contiguous span that covers them (4.5 step 6). The rest of the row is never
 * rewritten, so a concurrent write to a different column cannot be clobbered.
 *
 * @param {string} sheetName
 * @param {number} rowIndex 1-based sheet row
 * @param {!Object} patch header -> value
 * @param {!Object<string,string>=} kinds header -> 'bool' | 'number'
 * @return {number} cells written
 */
function writeRowCells_(sheetName, rowIndex, patch, kinds) {
  var target = sheet_(sheetName);
  var map = headerMap_(target);
  var columnKinds = kinds || {};

  var indexes = [];
  for (var header in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, header)) continue;
    indexes.push(columnIndex_(map, header, sheetName));
  }
  if (!indexes.length) return 0;

  var first = Math.min.apply(null, indexes);
  var last = Math.max.apply(null, indexes);
  var width = last - first + 1;

  // Read the span so untouched columns inside it are written back unchanged.
  var span = target.getRange(rowIndex, first + 1, 1, width).getValues()[0];
  for (var key in patch) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    var offset = map[key] - first;
    span[offset] = coerceForWrite_(patch[key], columnKinds[key]);
  }

  target.getRange(rowIndex, first + 1, 1, width).setValues([span]);
  return indexes.length;
}

/**
 * Appends rows in ONE setValues call (4.5 step 7, 4.7 "batch writes").
 * @param {string} sheetName
 * @param {!Array<!Object>} records
 * @param {!Object<string,string>=} kinds
 * @return {number} rows appended
 */
function appendRows_(sheetName, records, kinds) {
  if (!records || !records.length) return 0;
  var target = sheet_(sheetName);
  var headers = headersOf_(target);
  var columnKinds = kinds || {};

  var rows = records.map(function (record) {
    return headers.map(function (header) {
      return coerceForWrite_(
        Object.prototype.hasOwnProperty.call(record, header) ? record[header] : '',
        columnKinds[header]
      );
    });
  });

  target.getRange(target.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  return rows.length;
}

function appendRow_(sheetName, record, kinds) {
  return appendRows_(sheetName, [record], kinds);
}

/* ------------------------------------------------------------------- locks */

/**
 * Wraps every mutating action (4.5 step 1 and 9).
 *
 * tryLock returns false on timeout; waitLock throws. Using tryLock keeps
 * LOCK_TIMEOUT an ordinary envelope rather than an exception path.
 *
 * @param {function(): T} work
 * @return {T}
 * @template T
 */
function withLock_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS_)) {
    var err = new Error('The desk is busy saving someone else\'s change. Try again.');
    err.code = 'LOCK_TIMEOUT';
    throw err;
  }
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

function lockTimeoutError_(err) {
  return !!err && err.code === 'LOCK_TIMEOUT';
}

/* ------------------------------------------------------------ change stamp */

/**
 * A cheap "something changed" counter in Script Properties. getChangeStamp polls
 * this and touches no sheet at all, so a 30-second poll across the whole team
 * costs almost nothing (B6 / 5.7).
 */
function bumpChangeStamp_(nowIso) {
  var stamp = (nowIso || nowIsoUtc_()) + '#' + Math.floor(Math.random() * 100000);
  setProp_(PROP_CHANGE_STAMP_, stamp);
  return stamp;
}

function changeStamp_() {
  return getProp_(PROP_CHANGE_STAMP_, '');
}

/** Flush pending writes, then publish the new stamp (4.5 step 8). */
function commitAndStamp_() {
  SpreadsheetApp.flush();
  return bumpChangeStamp_();
}

/* ---------------------------------------------------------------- settings */

/** SETTINGS as key -> raw string. Cached 60s; never authoritative (4.7). */
function settingsMap_() {
  var cacheKey = 'settings:' + getProp_(PROP_DB_ID_);
  var cached = null;
  try {
    cached = cache_().get(cacheKey);
  } catch (ignored) {
    cached = null;
  }
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (ignored2) {
      // Fall through to a fresh read.
    }
  }

  var map = {};
  var rows = readAll_(SHEET_NAMES_.SETTINGS);
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i].setting_key || '').trim();
    if (key) map[key] = String(rows[i].setting_value == null ? '' : rows[i].setting_value);
  }

  try {
    cache_().put(cacheKey, JSON.stringify(map), CACHE_TTL_SECONDS_);
  } catch (ignored3) {
    // Caching is optional.
  }
  return map;
}

function invalidateSettingsCache_() {
  try {
    cache_().remove('settings:' + getProp_(PROP_DB_ID_));
  } catch (ignored) {
    // Nothing to do - the next read falls through to the sheet.
  }
}

function settingText_(key, fallback) {
  var map = settingsMap_();
  var value = map[key];
  return value === undefined || value === '' ? (fallback === undefined ? '' : fallback) : value;
}

function settingNumber_(key, fallback) {
  var value = toNumberOrNull_(settingText_(key, ''));
  return value === null ? fallback : value;
}

function settingBool_(key, fallback) {
  var raw = settingText_(key, '');
  return raw === '' ? fallback : toBool_(raw);
}

/** The company timezone every business date is computed in (4.8). */
function businessTimezone_() {
  return settingText_('business_timezone', 'America/Los_Angeles');
}

/** Today, for the company - never the browser's idea of today (4.8). */
function businessToday_() {
  return businessDate_(nowIsoUtc_(), businessTimezone_(), gasFormatInZone_);
}

/* ------------------------------------------------------------ idempotency */

var IDEMPOTENCY_TTL_SECONDS_ = 600;

/**
 * Replay protection for note, attempt, tool-run and import actions (4.5 "+").
 *
 * A retried request - the user's second tap, a flaky connection - returns the
 * ORIGINAL result instead of posting twice. The cache is a convenience and never
 * the source of truth: if it has expired the action simply runs again, which is
 * why only actions that carry a client_request_id opt in.
 *
 * @param {!Object} ctx
 * @param {string} clientRequestId
 * @param {function(): T} work
 * @return {T}
 * @template T
 */
function idempotent_(ctx, clientRequestId, work) {
  var requestId = String(clientRequestId || '').trim();
  if (!requestId) return work();

  var key = 'idem:' + ctx.user_id + ':' + requestId;
  try {
    var cached = cache_().get(key);
    if (cached) return JSON.parse(cached);
  } catch (ignored) {
    // A cache miss just means the work runs.
  }

  var result = work();

  try {
    cache_().put(key, JSON.stringify(result), IDEMPOTENCY_TTL_SECONDS_);
  } catch (ignored2) {
    // Storing the result is best-effort.
  }
  return result;
}

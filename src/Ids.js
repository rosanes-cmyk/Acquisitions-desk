/**
 * Ids.js - permanent record identifiers.
 *
 * PURE FILE. No SpreadsheetApp / Session / Utilities / PropertiesService / CacheService.
 * Platform capabilities arrive as injected functions so test/ can run this file
 * unchanged under Node (see test/helpers/loadPure.js).
 *
 * Rule 3.2.7: the row number is never an ID.
 */

/** A-Z2-9 exactly as pinned in 3.2.7: the full alphabet plus 2-9, so no 0 or 1. */
var ID_ALPHABET_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';
var ID_SUFFIX_LENGTH_ = 5;
var ID_MAX_ATTEMPTS_ = 25;

var ID_PREFIX_ = {
  LEAD: 'LEAD',
  ACTIVITY: 'ACT',
  APPOINTMENT: 'APPT',
  RUN: 'RUN',
  USER: 'USR',
  TOOL: 'TOOL',
  EVENT: 'EVT',
  ERROR: 'ERR',
  BACKUP: 'BKP',
  TRAINING: 'TRN'
};

/**
 * @param {number} length
 * @param {function():number=} randomFn injectable for deterministic tests
 * @return {string}
 */
function randomSuffix_(length, randomFn) {
  var rnd = randomFn || Math.random;
  var out = '';
  for (var i = 0; i < length; i++) {
    out += ID_ALPHABET_.charAt(Math.floor(rnd() * ID_ALPHABET_.length) % ID_ALPHABET_.length);
  }
  return out;
}

/** '2026-09-11' -> '20260911'; also accepts an already-compact stamp. */
function compactDate_(isoDate) {
  return String(isoDate == null ? '' : isoDate).replace(/[^0-9]/g, '');
}

/** '2026-09-11T18:23:15Z' -> '20260911182315' */
function compactStamp_(isoUtc) {
  return compactDate_(isoUtc).slice(0, 14);
}

/**
 * Builds one candidate id. Callers that need uniqueness use newUniqueId_.
 * @param {string} prefix
 * @param {string} stamp already-compact digits
 * @param {function():number=} randomFn
 * @return {string}
 */
function buildId_(prefix, stamp, randomFn) {
  return prefix + '-' + stamp + '-' + randomSuffix_(ID_SUFFIX_LENGTH_, randomFn);
}

/**
 * Generates an id that does not already exist. Retries on collision (3.2.7).
 * @param {string} prefix
 * @param {string} stamp compact digits (business date for LEAD/RUN/APPT, timestamp otherwise)
 * @param {function(string):boolean=} existsFn returns true when the id is taken
 * @param {function():number=} randomFn
 * @return {string}
 */
function newUniqueId_(prefix, stamp, existsFn, randomFn) {
  var taken = existsFn || function () { return false; };
  for (var attempt = 0; attempt < ID_MAX_ATTEMPTS_; attempt++) {
    var candidate = buildId_(prefix, stamp, randomFn);
    if (!taken(candidate)) return candidate;
  }
  throw new Error(
    'Could not generate a unique ' + prefix + ' id after ' + ID_MAX_ATTEMPTS_ + ' attempts.'
  );
}

/** LEAD-yyyyMMdd-XXXXX, keyed on the business date the lead was created. */
function newLeadId_(businessDate, existsFn, randomFn) {
  return newUniqueId_(ID_PREFIX_.LEAD, compactDate_(businessDate), existsFn, randomFn);
}

/** Matches the format only - it says nothing about whether the record exists. */
function isValidIdFormat_(prefix, value) {
  if (typeof value !== 'string') return false;
  var pattern = new RegExp(
    '^' + prefix + '-[0-9]{6,14}-[' + ID_ALPHABET_ + ']{' + ID_SUFFIX_LENGTH_ + '}$'
  );
  return pattern.test(value);
}

/**
 * Seeded tools keep their prototype ids ('retell', 'plbids', ...), so a tool id is
 * valid either as a generated TOOL-... id or as a lowercase seed slug.
 */
function isValidToolId_(value) {
  if (typeof value !== 'string' || !value) return false;
  return isValidIdFormat_(ID_PREFIX_.TOOL, value) || /^[a-z0-9][a-z0-9_-]{0,39}$/.test(value);
}

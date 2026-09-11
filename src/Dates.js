/**
 * Dates.js - business dates and the month / 30-day windows.
 *
 * PURE CORE + one Utilities.formatDate adapter at the bottom (4.1).
 *
 * Every value in and out is a STRING. Date objects never cross a function
 * boundary here and never reach the client: google.script.run cannot carry them
 * and Sheets coerces them (B4 / 3.2.3). A Date is used only as local arithmetic
 * scratch inside addDays_ and daysInMonth_.
 *
 * "Today" is always the company's business date (4.8). A user in the Philippines
 * at 2pm and a user in California at 11pm the previous evening write into the
 * same company day.
 */

var WEEKDAY_NAMES_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** Strict yyyy-MM-dd AND a real calendar date ('2026-02-30' is false). */
function isIsoDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var p = { y: +value.slice(0, 4), m: +value.slice(5, 7), d: +value.slice(8, 10) };
  if (p.m < 1 || p.m > 12 || p.d < 1) return false;
  return p.d <= daysInMonthOf_(p.y, p.m);
}

/** Strict HH:mm, 00:00 - 23:59. */
function isHhMm_(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** ISO 8601 UTC to the second, e.g. 2026-09-11T18:23:15Z. */
function isIsoTimestamp_(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
}

function parseIsoDate_(iso) {
  if (!isIsoDate_(iso)) throw new Error('Not a yyyy-MM-dd date: ' + iso);
  return { y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) };
}

function toIsoDate_(y, m, d) {
  return String(y) + '-' + pad2_(m) + '-' + pad2_(d);
}

function daysInMonthOf_(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date part of a timestamp, or the date itself. '' for anything else. */
function datePartOf_(value) {
  if (typeof value !== 'string' || value.length < 10) return '';
  var head = value.slice(0, 10);
  return isIsoDate_(head) ? head : '';
}

function addDays_(iso, days) {
  var p = parseIsoDate_(iso);
  var shifted = new Date(Date.UTC(p.y, p.m - 1, p.d) + days * 86400000);
  return toIsoDate_(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** b - a, in whole days. Negative when b is earlier. */
function daysBetween_(isoA, isoB) {
  var a = parseIsoDate_(isoA);
  var b = parseIsoDate_(isoB);
  return Math.round(
    (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000
  );
}

/** -1, 0 or 1. Safe because yyyy-MM-dd sorts lexicographically. */
function compareIso_(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }

/** 0 = Sunday. A civil date has a weekday regardless of timezone. */
function dayOfWeek_(iso) {
  var p = parseIsoDate_(iso);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

function isWeekend_(iso) {
  var dow = dayOfWeek_(iso);
  return dow === 0 || dow === 6;
}

function dayOfMonth_(iso) { return parseIsoDate_(iso).d; }

function daysInMonth_(iso) {
  var p = parseIsoDate_(iso);
  return daysInMonthOf_(p.y, p.m);
}

function firstOfMonth_(iso) {
  var p = parseIsoDate_(iso);
  return toIsoDate_(p.y, p.m, 1);
}

/** Month window start (6.4): the first day of the current business month. */
function monthWindowStart_(isoToday) { return firstOfMonth_(isoToday); }

/** 30-day window start (6.4): businessToday - 30 days, inclusive. */
function window30Start_(isoToday) { return addDays_(isoToday, -30); }

/** Inclusive on both ends. Blank or malformed dates are never "within". */
function isWithin_(iso, startIso, endIso) {
  if (!isIsoDate_(iso)) return false;
  if (startIso && compareIso_(iso, startIso) < 0) return false;
  if (endIso && compareIso_(iso, endIso) > 0) return false;
  return true;
}

function weekdayName_(iso) { return WEEKDAY_NAMES_[dayOfWeek_(iso)]; }
function monthName_(iso) { return MONTH_NAMES_[parseIsoDate_(iso).m - 1]; }

/** 'Friday, September 11' - the Today tab's log heading. */
function formatLongDate_(iso) {
  return weekdayName_(iso) + ', ' + monthName_(iso) + ' ' + dayOfMonth_(iso);
}

/** 'MM-DD' - the queue's "Overdue since {MM-DD}". */
function formatShortDate_(iso) {
  var p = parseIsoDate_(iso);
  return pad2_(p.m) + '-' + pad2_(p.d);
}

/**
 * ISO 8601 UTC to the second. Accepts an injected clock for tests.
 * @param {Date=} now
 */
function nowIsoUtc_(now) {
  return (now || new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The company business date for an instant (4.8).
 * @param {string} isoUtc instant, ISO 8601
 * @param {string} timezone IANA zone from SETTINGS.business_timezone
 * @param {function(string,string):string} formatInZone adapter; Apps Script passes
 *     gasFormatInZone_, Node tests pass an Intl-based equivalent
 * @return {string} yyyy-MM-dd
 */
function businessDate_(isoUtc, timezone, formatInZone) {
  if (typeof formatInZone !== 'function') {
    throw new Error('businessDate_ needs a formatInZone adapter.');
  }
  var iso = formatInZone(isoUtc, timezone);
  if (!isIsoDate_(iso)) throw new Error('formatInZone returned a bad date: ' + iso);
  return iso;
}

/**
 * APPS SCRIPT ADAPTER - the only non-pure function in this file. Utilities is
 * resolved when it is called, not when the file loads, so Node can still load
 * this file for Tier 1.
 */
function gasFormatInZone_(isoUtc, timezone) {
  return Utilities.formatDate(new Date(isoUtc), timezone, 'yyyy-MM-dd');
}

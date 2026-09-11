'use strict';
/**
 * Loads the pure Apps Script files into one shared VM context, the way Apps
 * Script itself shares a global scope across .gs files.
 *
 * vm.runInContext (not require) is deliberate: it means the source files need no
 * module.exports shim, so nothing in src/ exists only to make tests work, and no
 * accidental global is introduced by the test harness itself.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');

/** The files that must stay free of SpreadsheetApp / Session / Utilities (4.1). */
const PURE_FILES = ['Ids.js', 'Dates.js', 'Validate.js', 'Calc.js'];

function loadPure(files = PURE_FILES) {
  const context = vm.createContext({ console });
  for (const file of files) {
    const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }
  return context;
}

/**
 * The Node stand-in for gasFormatInZone_ (Utilities.formatDate). en-CA renders
 * as YYYY-MM-DD, which is the format businessDate_ expects back.
 */
function formatInZone(isoUtc, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(isoUtc));
}

/** A deterministic stand-in for Math.random, so id tests are repeatable. */
function sequenceRandom(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

module.exports = { loadPure, formatInZone, sequenceRandom, PURE_FILES, SRC_DIR };

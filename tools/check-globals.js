#!/usr/bin/env node
'use strict';
/**
 * Static check - Tier 2 case 17, wired into `npm test` so it blocks every push.
 *
 * In Apps Script EVERY top-level function is callable from the browser via
 * google.script.run by anyone who can open the web app. A single stray global is
 * a hole in the whole authorization model (4.2, rule 1.11). So:
 *
 *   1. Only `api`, `doGet` and the five guarded editor-run admin entry points may
 *      be global. Every other function name must end with `_`.
 *   2. The pure files must not touch platform services, or Tier 1 cannot run them
 *      under Node (4.1). The one documented exception is a `gas*_` adapter.
 *
 * Exit code 1 fails the build and names the file, line and symbol.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

/** 4.2.3 - the only functions allowed to be reachable without a trailing underscore. */
const ALLOWED_GLOBALS = new Set([
  'api',              // the ONE client entry point
  'doGet',            // the web app entry point
  'setupDatabase',    // editor-run, requireRole_('ADMIN'), idempotent
  'installTriggers',  // editor-run, requireRole_('ADMIN'), idempotent
  'createDatabaseBackup',
  'runSelfTests',     // DEV only
  'createTestData'    // DEV only
]);

const PURE_FILES = new Set(['Ids.js', 'Dates.js', 'Validate.js', 'Calc.js']);

/** Services a pure file may never reach for (4.1). */
const PLATFORM_SERVICES = ['SpreadsheetApp', 'DriveApp', 'Session', 'PropertiesService',
  'CacheService', 'LockService', 'HtmlService', 'ScriptApp', 'MailApp', 'UrlFetchApp', 'Utilities'];

/** Drops comments so prose about SpreadsheetApp is not mistaken for a call. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, (match) => match.replace(/[^\n]/g, ' '));
}

/**
 * Removes whole `function gas..._(...) { ... }` blocks. These are the declared
 * platform adapters (e.g. gasFormatInZone_) - the one place a pure file is
 * allowed to name a service, because Node never calls them.
 */
function stripGasAdapters(source) {
  const lines = source.split('\n');
  const out = [];
  let inAdapter = false;
  for (const line of lines) {
    if (!inAdapter && /^function\s+gas[A-Za-z0-9_$]*_\s*\(/.test(line)) {
      inAdapter = true;
      out.push('');
      continue;
    }
    if (inAdapter) {
      out.push('');
      if (line === '}') inAdapter = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

const problems = [];

function report(file, lineNumber, message) {
  problems.push(`${path.join('src', file)}:${lineNumber}  ${message}`);
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
if (!files.length) {
  console.error('check-globals: no .js files found in src/.');
  process.exit(1);
}

let functionCount = 0;

for (const file of files) {
  const source = stripComments(fs.readFileSync(path.join(SRC_DIR, file), 'utf8'));
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // Top-level function declarations - the ones google.script.run can reach.
    const declared = /^function\s+([A-Za-z0-9_$]+)\s*\(/.exec(line);
    if (declared) {
      functionCount++;
      const name = declared[1];
      if (!name.endsWith('_') && !ALLOWED_GLOBALS.has(name)) {
        report(file, lineNumber,
          `global function "${name}" is callable from the browser. ` +
          'Rename it to end with "_" or add it to the guarded entry points.');
      }
    }

    // Top-level function-valued bindings. Not client-callable, but they read as
    // API surface, so the same naming rule applies.
    const bound = /^(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*(?:function\b|\(?[A-Za-z0-9_$,\s]*\)?\s*=>)/
      .exec(line);
    if (bound && !bound[1].endsWith('_') && !ALLOWED_GLOBALS.has(bound[1])) {
      report(file, lineNumber, `top-level function "${bound[1]}" should end with "_".`);
    }
  });

  if (PURE_FILES.has(file)) {
    stripGasAdapters(source).split('\n').forEach((line, index) => {
      for (const service of PLATFORM_SERVICES) {
        if (new RegExp(`\\b${service}\\b`).test(line)) {
          report(file, index + 1,
            `pure file references ${service}. Tier 1 loads this file under Node - ` +
            'pass an adapter in instead.');
        }
      }
    });
  }
}

if (problems.length) {
  console.error('check-globals FAILED\n');
  for (const problem of problems) console.error('  ' + problem);
  console.error(`\n${problems.length} problem(s). See 4.2 "Client-callable surface - CRITICAL".`);
  process.exit(1);
}

console.log(
  `check-globals OK - ${files.length} file(s), ${functionCount} function(s); ` +
  `client-callable surface limited to: ${[...ALLOWED_GLOBALS].join(', ')}.`
);

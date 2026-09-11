#!/usr/bin/env node
'use strict';
/**
 * Static check - every private symbol that is CALLED somewhere in src/ is also
 * DEFINED somewhere in src/.
 *
 * Apps Script shares one global scope across .gs files, so a call into another
 * file is never resolved until that line runs in production. A typo in a helper
 * name would otherwise surface as a live SERVER_ERROR. This catches it locally.
 */
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src');

/** Apps Script built-ins, plus the standard JS globals. */
const PLATFORM_GLOBALS = new Set(['SpreadsheetApp', 'DriveApp', 'Session', 'PropertiesService',
  'CacheService', 'LockService', 'HtmlService', 'ScriptApp', 'Utilities', 'Logger', 'MailApp',
  'UrlFetchApp', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date',
  'RegExp', 'Error', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'console', 'encodeURIComponent',
  'decodeURIComponent']);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, (match) => match.replace(/[^\n]/g, ' '));
}

const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
const sources = new Map(
  files.map((file) => [file, stripComments(fs.readFileSync(path.join(SRC_DIR, file), 'utf8'))])
);

// Everything defined at the top level of any file, plus locals declared anywhere.
const defined = new Set(PLATFORM_GLOBALS);
for (const source of sources.values()) {
  for (const match of source.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)) defined.add(match[1]);
  for (const match of source.matchAll(/(?:^|\s)(?:var|let|const)\s+([A-Za-z0-9_$]+)/gm)) {
    defined.add(match[1]);
  }
  // Parameters and catch bindings are local names too.
  for (const match of source.matchAll(/function\s*[A-Za-z0-9_$]*\s*\(([^)]*)\)/g)) {
    for (const param of match[1].split(',')) {
      const name = param.trim();
      if (name) defined.add(name);
    }
  }
  for (const match of source.matchAll(/catch\s*\(\s*([A-Za-z0-9_$]+)\s*\)/g)) defined.add(match[1]);
}

const problems = [];
for (const [file, source] of sources) {
  source.split('\n').forEach((line, index) => {
    // Calls to a private helper: name_( not preceded by a dot.
    for (const match of line.matchAll(/(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*_)\s*\(/g)) {
      const name = match[2];
      if (!defined.has(name)) {
        problems.push(`${path.join('src', file)}:${index + 1}  calls ${name}() which is not defined`);
      }
    }
  });
}

if (problems.length) {
  console.error('check-references FAILED\n');
  for (const problem of [...new Set(problems)]) console.error('  ' + problem);
  process.exit(1);
}

console.log(`check-references OK - ${files.length} file(s), ${defined.size} symbols in scope.`);

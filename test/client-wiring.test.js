'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadPure, SRC_DIR } = require('./helpers/loadPure');

const ALL_JS = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js')).sort();
const C = loadPure(ALL_JS);
const REGISTRY = C.actionRegistry_();

function read(file) { return fs.readFileSync(path.join(SRC_DIR, file), 'utf8'); }

const CLIENT_FILES = ['Scripts.html', 'Admin.html'];

/** Every THB.call('x') / call('x') site in the client. */
function actionsCalledIn(source) {
  const found = new Set();
  for (const m of source.matchAll(/\bcall\(\s*'([A-Za-z_][A-Za-z0-9_]*)'/g)) found.add(m[1]);
  return found;
}

// The client and the dispatcher are wired across a boundary nothing else checks:
// a typo here is a live SERVER_ERROR for a real user, on a real lead.
test('every action the client calls exists in the server registry', () => {
  for (const file of CLIENT_FILES) {
    for (const action of actionsCalledIn(read(file))) {
      assert.equal(action in REGISTRY, true,
        `${file} calls api("${action}") but the registry has no such action`);
    }
  }
});

test('the client reaches the server only through api(), never a bare global', () => {
  for (const file of CLIENT_FILES) {
    const source = read(file);
    const runCalls = [...source.matchAll(/google\.script\.run[\s\S]{0,400}?\.([a-zA-Z_]\w*)\(/g)]
      .map((m) => m[1])
      .filter((name) => !['withSuccessHandler', 'withFailureHandler'].includes(name));
    for (const name of runCalls) {
      assert.equal(name, 'api',
        `${file} calls google.script.run.${name}() — everything must go through api()`);
    }
  }
});

test('the client never writes company data to browser storage (rule 1.4)', () => {
  const allowed = ['tab'];
  for (const file of CLIENT_FILES) {
    const source = read(file);
    for (const m of source.matchAll(/remember\(\s*'([a-z_]+)'/g)) {
      assert.equal(allowed.includes(m[1]), true,
        `${file} stores "${m[1]}" in localStorage; only ${allowed.join(', ')} is permitted`);
    }
    assert.equal(/window\.storage/.test(source), false,
      `${file} still references window.storage`);
  }
});

// 5.9: seller name, address, notes, equity text, tool names and URLs are all
// hostile input. Every one of them must pass through esc() on the way into HTML.
test('hostile fields are never interpolated into HTML unescaped (5.9)', () => {
  const HOSTILE = ['address', 'seller_name', 'equity_note', 'next_action', 'text', 'note',
    'name', 'link', 'operator', 'built_by', 'expected_output', 'archive_reason', 'details',
    'error', 'message', 'latest_note', 'assignee_name', 'backup_name', 'user_email'];

  for (const file of CLIENT_FILES) {
    const source = read(file);
    for (const field of HOSTILE) {
      // A concatenation like  ' + l.address + '  with no esc( just before it.
      const pattern = new RegExp(`\\+\\s*([A-Za-z_$][\\w$]*(?:\\[[^\\]]+\\])?\\.${field})\\b`, 'g');
      for (const m of source.matchAll(pattern)) {
        const before = source.slice(Math.max(0, m.index - 26), m.index + m[0].length);
        assert.equal(/esc\(|money\(|Number\(|pct\(|dash\(/.test(before), true,
          `${file}: "${m[1]}" is concatenated into HTML without esc()`);
      }
    }
  }
  assert.equal(read('Scripts.html').includes('function esc('), true, 'esc() must exist');
});

test('Index.html includes the three partials and nothing undefined', () => {
  const index = read('Index.html');
  for (const partial of ['Styles', 'Scripts', 'Admin']) {
    assert.equal(index.includes(`include_('${partial}')`), true, `Index must include ${partial}`);
  }
  const scriptlets = [...index.matchAll(/<\?!?=?\s*([a-zA-Z_]\w*)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(scriptlets)], ['include_'],
    'Index.html should use no template variable other than include_');
});

test('doGet renders Index for a resolved user and Access otherwise (5.1)', () => {
  const code = read('Code.js');
  assert.match(code, /createTemplateFromFile\('Index'\)/);
  assert.match(code, /createTemplateFromFile\('Access'\)/);
  // HtmlService ignores <meta> inside the HTML, so the viewport must be added here.
  assert.match(code, /addMetaTag\('viewport'/);
});

test('the five HTML partials the frontend needs all exist', () => {
  for (const file of ['Index.html', 'Styles.html', 'Scripts.html', 'Admin.html', 'Access.html']) {
    assert.equal(fs.existsSync(path.join(SRC_DIR, file)), true, `${file} is missing`);
  }
});

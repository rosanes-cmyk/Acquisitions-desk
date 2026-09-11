#!/usr/bin/env node
/**
 * Copies .clasp.<env>.json over .clasp.json so `clasp push` targets the right
 * script project. clasp always reads .clasp.json from the working directory,
 * so switching environments means switching that file.
 *
 *   node tools/use-env.js dev
 *   node tools/use-env.js prod
 */
'use strict';
const fs = require('fs');
const path = require('path');

const env = (process.argv[2] || '').toLowerCase();
if (env !== 'dev' && env !== 'prod') {
  console.error('Usage: node tools/use-env.js <dev|prod>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const source = path.join(root, `.clasp.${env}.json`);
const target = path.join(root, '.clasp.json');

if (!fs.existsSync(source)) {
  console.error(`Missing ${path.basename(source)}.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(source, 'utf8'));
if (String(config.scriptId).startsWith('REPLACE_WITH_')) {
  console.error(
    `${path.basename(source)} still has a placeholder scriptId.\n` +
      'Put the real Apps Script project id in it first (RUNBOOK.md, "First run").'
  );
  process.exit(1);
}

fs.copyFileSync(source, target);
console.log(`clasp target: ${env.toUpperCase()}  (scriptId ${config.scriptId})`);

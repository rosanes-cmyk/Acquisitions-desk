'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadPure } = require('./helpers/loadPure');

const C = loadPure();

test('tab-delimited paste from a spreadsheet is detected', () => {
  const result = C.parseLeadLines_(
    '123 Main St\tJane Doe\t510-555-0134\tPPC\tFree and clear\n' +
    '45 Oak Ave\tSam Roe\t510-555-9999\tTV\tSome equity'
  );
  assert.equal(result.delimiter, '\t');
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    line: 1,
    address: '123 Main St',
    seller_name: 'Jane Doe',
    phone: '510-555-0134',
    source: 'PPC',
    equity_note: 'Free and clear'
  });
});

test('comma is the fallback delimiter', () => {
  const result = C.parseLeadLines_('123 Main St,Jane Doe,5105550134,PPC,Free and clear');
  assert.equal(result.delimiter, ',');
  assert.equal(result.rows[0].seller_name, 'Jane Doe');
});

test('a header line whose first cell is "address" is skipped', () => {
  const result = C.parseLeadLines_(
    'Address,Seller,Phone,Source,Equity\n123 Main St,Jane Doe,5105550134,PPC,Free'
  );
  assert.equal(result.headerSkipped, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].address, '123 Main St');
  assert.equal(result.rows[0].line, 2, 'line numbers follow the original text');
});

test('a first line that is real data is not mistaken for a header', () => {
  const result = C.parseLeadLines_('123 Main St,Jane Doe');
  assert.equal(result.headerSkipped, false);
  assert.equal(result.rows.length, 1);
});

test('extra cells join into the equity note - nothing is silently discarded (5.8)', () => {
  const result = C.parseLeadLines_('1 A St,Jane,555,PPC,note one,note two,note three');
  assert.equal(result.rows[0].equity_note, 'note one note two note three');
});

test('extra cells still land in the note when the note column itself is blank', () => {
  const result = C.parseLeadLines_('1 A St,Jane,555,PPC,,trailing detail');
  assert.equal(result.rows[0].equity_note, 'trailing detail');
});

test('whitespace is normalized on every field', () => {
  const result = C.parseLeadLines_('  123   Main  St ,  Jane   Doe  , 510 555 0134 , PPC , a   b ');
  assert.deepEqual(result.rows[0], {
    line: 1,
    address: '123 Main St',
    seller_name: 'Jane Doe',
    phone: '510 555 0134',
    source: 'PPC',
    equity_note: 'a b'
  });
});

test('blank lines are dropped but the surviving rows keep their original line numbers', () => {
  const result = C.parseLeadLines_('\n\n123 Main St,Jane\n\n   \n45 Oak Ave,Sam\n');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].line, 3);
  assert.equal(result.rows[1].line, 6);
});

test('short rows are parsed, not rejected here - the server decides what is valid', () => {
  const result = C.parseLeadLines_('123 Main St');
  assert.deepEqual(result.rows[0], {
    line: 1, address: '123 Main St', seller_name: '', phone: '', source: '', equity_note: ''
  });
});

test('a row with no address survives parsing so it can be reported by line number', () => {
  const result = C.parseLeadLines_('123 Main St,Jane\n,Nobody,555');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].address, '');
  assert.equal(result.rows[1].line, 2);
});

test('empty and whitespace-only input parse to no rows', () => {
  assert.equal(C.parseLeadLines_('').rows.length, 0);
  assert.equal(C.parseLeadLines_('   \n  \n').rows.length, 0);
  assert.equal(C.parseLeadLines_(null).rows.length, 0);
  assert.equal(C.parseLeadLines_(undefined).rows.length, 0);
});

test('CRLF and bare CR line endings are handled', () => {
  assert.equal(C.parseLeadLines_('1 A St,Jane\r\n2 B St,Sam').rows.length, 2);
  assert.equal(C.parseLeadLines_('1 A St,Jane\r2 B St,Sam').rows.length, 2);
});

test('the bulk import chunk size is pinned at 200 rows (4.6)', () => {
  assert.equal(C.BULK_IMPORT_MAX_ROWS_, 200);
});

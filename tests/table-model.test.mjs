import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteTable,
  deleteTableColumn,
  deleteTableRow,
  extractTables,
  insertSimpleTable,
  insertTableColumn,
  insertTableRow
} from '../src/table-model.mjs';

const SIMPLE = `<!doctype html>
<html>
<body>
<p>Before</p>
<table class="report">
  <thead>
    <tr class="header"><th class="name">Name</th><th>Score</th></tr>
  </thead>
  <tbody>
    <tr class="data"><td class="name">Alice</td><td>90</td></tr>
    <tr class="data"><td class="name">Bob</td><td>85</td></tr>
  </tbody>
</table>
<p>After</p>
</body>
</html>`;

test('extracts simple tables with row and cell identities', () => {
  const tables = extractTables(SIMPLE);

  assert.equal(tables.length, 1);
  assert.equal(tables[0].id, 'table-1');
  assert.equal(tables[0].simple, true);
  assert.equal(tables[0].rowCount, 3);
  assert.equal(tables[0].columnCount, 2);
  assert.equal(tables[0].rows[1].cells[0].tag, 'td');
});

test('inserts and deletes rows with source-preserving structural patches', () => {
  const table = extractTables(SIMPLE)[0];
  const row = table.rows[1];

  const inserted = insertTableRow(SIMPLE, table.id, row.id, 'below');

  assert.match(inserted, /<tr class="data"><td class="name">&nbsp;<\/td><td>&nbsp;<\/td><\/tr>/);
  assert.match(inserted, /<table class="report">/);
  assert.match(inserted, /<p>Before<\/p>/);

  const insertedModel = extractTables(inserted)[0];
  assert.equal(insertedModel.rowCount, 4);

  const deleted = deleteTableRow(
    inserted,
    insertedModel.id,
    insertedModel.rows[2].id
  );

  assert.equal(extractTables(deleted)[0].rowCount, 3);
  assert.doesNotMatch(deleted, /&nbsp;/);
});

test('inserts and deletes a full column across simple table rows', () => {
  const table = extractTables(SIMPLE)[0];

  const inserted = insertTableColumn(SIMPLE, table.id, 0, 'right');
  const insertedTable = extractTables(inserted)[0];

  assert.equal(insertedTable.simple, true);
  assert.equal(insertedTable.columnCount, 3);
  assert.match(inserted, /<th class="name">Name<\/th><th class="name">&nbsp;<\/th>/);
  assert.match(inserted, /<td class="name">Alice<\/td><td class="name">&nbsp;<\/td>/);

  const deleted = deleteTableColumn(inserted, insertedTable.id, 1);
  const deletedTable = extractTables(deleted)[0];

  assert.equal(deletedTable.columnCount, 2);
  assert.doesNotMatch(deleted, /&nbsp;/);
  assert.match(deleted, /Alice/);
  assert.match(deleted, /90/);
});

test('deletes an entire table without rewriting surrounding HTML', () => {
  const table = extractTables(SIMPLE)[0];
  const updated = deleteTable(SIMPLE, table.id);

  assert.doesNotMatch(updated, /<table/);
  assert.match(updated, /<p>Before<\/p>/);
  assert.match(updated, /<p>After<\/p>/);
});

test('inserts a new simple table at a requested source offset', () => {
  const source = '<html><body><p>Intro</p><p>Tail</p></body></html>';
  const offset = source.indexOf('<p>Tail</p>');
  const updated = insertSimpleTable(source, 2, 3, offset);
  const table = extractTables(updated)[0];

  assert.equal(table.simple, true);
  assert.equal(table.rowCount, 2);
  assert.equal(table.columnCount, 3);
  assert.ok(updated.indexOf('<table>') < updated.indexOf('<p>Tail</p>'));
  assert.equal((updated.match(/<td>&nbsp;<\/td>/g) ?? []).length, 6);
});

test('complex tables are detected and reject automatic row/column insertion', () => {
  const source = '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>';
  const table = extractTables(source)[0];

  assert.equal(table.simple, false);

  assert.throws(
    () => insertTableRow(source, table.id, table.rows[0].id, 'below'),
    /simple tables/
  );

  assert.throws(
    () => insertTableColumn(source, table.id, 0, 'right'),
    /simple tables/
  );

  assert.throws(
    () => deleteTableColumn(source, table.id, 0),
    /simple tables/
  );
});

test('prevents deleting the final row or final column accidentally', () => {
  const source = '<table><tr><td>Only</td></tr></table>';
  const table = extractTables(source)[0];

  assert.throws(
    () => deleteTableRow(source, table.id, table.rows[0].id),
    /last row/
  );

  assert.throws(
    () => deleteTableColumn(source, table.id, 0),
    /last column/
  );
});

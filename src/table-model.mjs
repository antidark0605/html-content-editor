import { parse } from 'parse5';

const ROW_ATTRIBUTES = new Set(['class', 'style']);
const CELL_ATTRIBUTES = new Set([
  'class',
  'style',
  'scope',
  'headers',
  'align',
  'valign',
  'width'
]);

function tagName(node) {
  return typeof node?.tagName === 'string' ? node.tagName.toLowerCase() : null;
}

function attrValue(node, name) {
  return node?.attrs?.find((attr) => attr.name === name)?.value ?? null;
}

function spanValue(node, name) {
  const raw = attrValue(node, name);
  if (raw === null || raw === '') return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function locationOf(node) {
  const location = node?.sourceCodeLocation;
  if (!location ||
      !Number.isInteger(location.startOffset) ||
      !Number.isInteger(location.endOffset)) {
    return null;
  }
  return location;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function filteredAttributes(node, allowlist) {
  return (node?.attrs ?? [])
    .filter((attr) => allowlist.has(attr.name))
    .map((attr) => ` ${attr.name}="${escapeAttribute(attr.value)}"`)
    .join('');
}

function collectRows(tableNode) {
  const rows = [];

  function visit(node) {
    for (const child of node?.childNodes ?? []) {
      if (child !== tableNode && tagName(child) === 'table') {
        continue;
      }

      if (tagName(child) === 'tr') {
        rows.push(child);
        continue;
      }

      visit(child);
    }
  }

  visit(tableNode);
  return rows;
}

function directCells(rowNode) {
  return (rowNode?.childNodes ?? [])
    .filter((child) => tagName(child) === 'td' || tagName(child) === 'th');
}

function containsNestedTable(tableNode) {
  let nested = false;

  function visit(node) {
    for (const child of node?.childNodes ?? []) {
      if (child !== tableNode && tagName(child) === 'table') {
        nested = true;
        return;
      }
      if (!nested) visit(child);
    }
  }

  visit(tableNode);
  return nested;
}

function buildTableRecords(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const records = [];
  let nextTable = 1;

  function visit(node) {
    if (tagName(node) === 'table' && locationOf(node)) {
      const tableId = `table-${nextTable++}`;
      const rowNodes = collectRows(node);
      const nested = containsNestedTable(node);
      const rows = rowNodes.map((rowNode, rowIndex) => {
        const cells = directCells(rowNode).map((cellNode, cellIndex) => ({
          id: `${tableId}-row-${rowIndex + 1}-cell-${cellIndex + 1}`,
          index: cellIndex,
          tag: tagName(cellNode),
          colspan: spanValue(cellNode, 'colspan'),
          rowspan: spanValue(cellNode, 'rowspan'),
          node: cellNode,
          location: locationOf(cellNode)
        }));

        return {
          id: `${tableId}-row-${rowIndex + 1}`,
          index: rowIndex,
          node: rowNode,
          location: locationOf(rowNode),
          cells
        };
      });

      const counts = rows.map((row) => row.cells.length);
      const columnCount = counts.length > 0 ? counts[0] : 0;
      const rectangular = columnCount > 0 && counts.every((count) => count === columnCount);
      const noSpans = rows.every((row) =>
        row.cells.every((cell) => cell.colspan === 1 && cell.rowspan === 1)
      );
      const simple = !nested && rows.length > 0 && rectangular && noSpans;

      records.push({
        id: tableId,
        index: records.length,
        node,
        location: locationOf(node),
        rowCount: rows.length,
        columnCount: simple ? columnCount : null,
        nested,
        simple,
        rows
      });
    }

    for (const child of node?.childNodes ?? []) {
      visit(child);
    }

    if (node?.content) visit(node.content);
  }

  visit(document);
  return records;
}

function publicTable(record) {
  return {
    id: record.id,
    index: record.index,
    rowCount: record.rowCount,
    columnCount: record.columnCount,
    nested: record.nested,
    simple: record.simple,
    rows: record.rows.map((row) => ({
      id: row.id,
      index: row.index,
      cellCount: row.cells.length,
      cells: row.cells.map((cell) => ({
        id: cell.id,
        index: cell.index,
        tag: cell.tag,
        colspan: cell.colspan,
        rowspan: cell.rowspan
      }))
    }))
  };
}

function tableById(source, tableId) {
  return buildTableRecords(source).find((table) => table.id === tableId) ?? null;
}

function rowById(table, rowId) {
  return table?.rows.find((row) => row.id === rowId) ?? null;
}

function applyPatches(source, patches) {
  const ordered = [...patches].sort((a, b) => b.start - a.start);
  let result = source;
  let lastStart = Number.POSITIVE_INFINITY;

  for (const patch of ordered) {
    if (!Number.isInteger(patch.start) ||
        !Number.isInteger(patch.end) ||
        patch.start < 0 ||
        patch.end < patch.start ||
        patch.end > lastStart) {
      throw new Error('Overlapping or invalid table source edits were detected.');
    }

    result =
      result.slice(0, patch.start) +
      patch.replacement +
      result.slice(patch.end);

    lastStart = patch.start;
  }

  return result;
}

function sourceLineIndent(source, offset) {
  const lineStart = Math.max(
    source.lastIndexOf('\n', Math.max(0, offset - 1)),
    source.lastIndexOf('\r', Math.max(0, offset - 1))
  ) + 1;
  const prefix = source.slice(lineStart, offset);
  return /^[\t ]*$/.test(prefix) ? prefix : '';
}

function preferredEol(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function emptyCellFrom(cellNode) {
  const tag = tagName(cellNode) === 'th' ? 'th' : 'td';
  return `<${tag}${filteredAttributes(cellNode, CELL_ATTRIBUTES)}>&nbsp;</${tag}>`;
}

function emptyRowFrom(row) {
  const attrs = filteredAttributes(row.node, ROW_ATTRIBUTES);
  const cells = row.cells.map((cell) => emptyCellFrom(cell.node)).join('');
  return `<tr${attrs}>${cells}</tr>`;
}

function emptyColumnCellFrom(cell) {
  return emptyCellFrom(cell.node);
}

function assertSimple(table, operation) {
  if (!table?.simple) {
    throw new Error(`${operation} is available only for simple tables without nested tables, rowspan, or colspan.`);
  }
}

export function extractTables(source) {
  if (typeof source !== 'string') return [];
  return buildTableRecords(source).map(publicTable);
}

export function deleteTable(source, tableId) {
  const table = tableById(source, tableId);
  if (!table?.location) throw new Error('The selected table no longer exists.');

  return applyPatches(source, [{
    start: table.location.startOffset,
    end: table.location.endOffset,
    replacement: ''
  }]);
}

export function deleteTableRow(source, tableId, rowId) {
  const table = tableById(source, tableId);
  const row = rowById(table, rowId);

  if (!table || !row?.location) {
    throw new Error('The selected table row no longer exists.');
  }

  if (table.rowCount <= 1) {
    throw new Error('This is the last row. Delete the table instead.');
  }

  return applyPatches(source, [{
    start: row.location.startOffset,
    end: row.location.endOffset,
    replacement: ''
  }]);
}

export function insertTableRow(source, tableId, rowId, direction) {
  const table = tableById(source, tableId);
  const row = rowById(table, rowId);

  if (!table || !row?.location) {
    throw new Error('The selected table row no longer exists.');
  }

  assertSimple(table, 'Insert row');

  if (direction !== 'above' && direction !== 'below') {
    throw new Error('Invalid row insertion direction.');
  }

  const markup = emptyRowFrom(row);
  const indent = sourceLineIndent(source, row.location.startOffset);
  const eol = preferredEol(source);

  if (direction === 'above') {
    return applyPatches(source, [{
      start: row.location.startOffset,
      end: row.location.startOffset,
      replacement: `${markup}${eol}${indent}`
    }]);
  }

  return applyPatches(source, [{
    start: row.location.endOffset,
    end: row.location.endOffset,
    replacement: `${eol}${indent}${markup}`
  }]);
}

export function deleteTableColumn(source, tableId, columnIndex) {
  const table = tableById(source, tableId);
  if (!table) throw new Error('The selected table no longer exists.');
  assertSimple(table, 'Delete column');

  if (!Number.isInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= table.columnCount) {
    throw new Error('The selected table column no longer exists.');
  }

  if (table.columnCount <= 1) {
    throw new Error('This is the last column. Delete the table instead.');
  }

  return applyPatches(source, table.rows.map((row) => {
    const cell = row.cells[columnIndex];
    if (!cell?.location) throw new Error('A table cell has no editable source location.');
    return {
      start: cell.location.startOffset,
      end: cell.location.endOffset,
      replacement: ''
    };
  }));
}

export function insertTableColumn(source, tableId, columnIndex, direction) {
  const table = tableById(source, tableId);
  if (!table) throw new Error('The selected table no longer exists.');
  assertSimple(table, 'Insert column');

  if (!Number.isInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= table.columnCount) {
    throw new Error('The selected table column no longer exists.');
  }

  if (direction !== 'left' && direction !== 'right') {
    throw new Error('Invalid column insertion direction.');
  }

  return applyPatches(source, table.rows.map((row) => {
    const cell = row.cells[columnIndex];
    if (!cell?.location) throw new Error('A table cell has no editable source location.');

    const offset = direction === 'left'
      ? cell.location.startOffset
      : cell.location.endOffset;

    return {
      start: offset,
      end: offset,
      replacement: emptyColumnCellFrom(cell)
    };
  }));
}

function simpleTableMarkup(rowCount, columnCount, eol) {
  const rows = [];

  for (let row = 0; row < rowCount; row += 1) {
    const cells = Array.from(
      { length: columnCount },
      () => '<td>&nbsp;</td>'
    ).join('');

    rows.push(`    <tr>${cells}</tr>`);
  }

  return [
    '<table>',
    '  <tbody>',
    ...rows,
    '  </tbody>',
    '</table>'
  ].join(eol);
}

export function defaultTableInsertionOffset(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  let body = null;

  function visit(node) {
    if (tagName(node) === 'body' && locationOf(node)) {
      body = node;
      return;
    }
    for (const child of node?.childNodes ?? []) {
      if (!body) visit(child);
    }
  }

  visit(document);

  const endTagStart = body?.sourceCodeLocation?.endTag?.startOffset;
  if (Number.isInteger(endTagStart)) return endTagStart;
  return source.length;
}

export function insertSimpleTable(source, rowCount, columnCount, offset = null) {
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > 20) {
    throw new Error('Table rows must be between 1 and 20.');
  }

  if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > 12) {
    throw new Error('Table columns must be between 1 and 12.');
  }

  const insertionOffset = Number.isInteger(offset)
    ? Math.max(0, Math.min(source.length, offset))
    : defaultTableInsertionOffset(source);

  const eol = preferredEol(source);
  const markup = simpleTableMarkup(rowCount, columnCount, eol);
  const before = source.slice(0, insertionOffset);
  const after = source.slice(insertionOffset);
  const prefix = before.length > 0 && !/[\r\n]$/.test(before) ? eol : '';
  const suffix = after.length > 0 && !/^[\r\n]/.test(after) ? eol : '';

  return before + prefix + markup + suffix + after;
}

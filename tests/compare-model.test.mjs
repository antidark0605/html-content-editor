import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSourceComparison,
  buildVisibleComparison,
  mergeSourceHunk,
  mergeVisibleTextHunk
} from '../src/compare-model.mjs';
import { mapAlignedPosition } from '../src/compare-utils.mjs';

test('visual comparison highlights changed visible text and preserves exact matches as anchors', () => {
  const left = '<main><h1>Title</h1><p>Hello old world</p><p>Same tail</p></main>';
  const right = '<main><h1>Title</h1><p>Hello new world</p><p>Same tail</p></main>';
  const comparison = buildVisibleComparison(left, right);

  assert.equal(comparison.hunks.length, 1);
  assert.equal(comparison.hunks[0].mergeableText, true);
  assert.match(comparison.leftHtml, /data-hce-hunk="diff-1"/);
  assert.match(comparison.leftHtml, /hce-inline-left/);
  assert.match(comparison.rightHtml, /hce-inline-right/);
  assert.ok(comparison.anchors.length >= 2);
});

test('visual text merge preserves target markup while copying text', () => {
  const left = '<p class="left">Hello <strong>better</strong> world</p>';
  const right = '<p class="right">Hello <strong>older</strong> world</p>';
  const comparison = buildVisibleComparison(left, right);
  const hunk = comparison.hunks[0];

  const merged = mergeVisibleTextHunk(left, right, hunk.id, 'left-to-right');

  assert.equal(merged.ok, true);
  assert.match(merged.rightSource, /class="right"/);
  assert.match(merged.rightSource, /<strong>better<\/strong>/);
  assert.doesNotMatch(merged.rightSource, /class="left"/);
});

test('source comparison creates aligned rows and can merge structural changes', () => {
  const left = '<main>\n  <h1>Title</h1>\n  <p>Alpha</p>\n</main>\n';
  const right = '<main>\n  <h1>Title</h1>\n  <p>Beta</p>\n  <p>Extra</p>\n</main>\n';
  const comparison = buildSourceComparison(left, right);

  assert.ok(comparison.hunks.length >= 1);
  assert.ok(comparison.rows.some((row) => row.hunkId));

  const first = comparison.hunks[0];
  const merged = mergeSourceHunk(left, right, first.id, 'left-to-right');
  assert.equal(merged.ok, true);

  const after = buildSourceComparison(merged.leftSource, merged.rightSource);
  assert.ok(after.hunks.length < comparison.hunks.length || merged.rightSource.includes('Alpha'));
});

test('content-aligned scrolling interpolates between matched anchors', () => {
  const points = [
    { left: 0, right: 0 },
    { left: 500, right: 800 },
    { left: 1000, right: 1200 }
  ];

  assert.equal(mapAlignedPosition(points, 250, 'left', 'right'), 400);
  assert.equal(mapAlignedPosition(points, 750, 'left', 'right'), 1000);
  assert.equal(mapAlignedPosition(points, 400, 'right', 'left'), 250);
});

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const root = process.cwd();
const outputDir = path.join(root, 'test-results');
await fs.mkdir(outputDir, { recursive: true });

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hce-ui-'));
const left = path.join(tempDir, 'compare-left.html');
const right = path.join(tempDir, 'compare-right.html');
const editorFile = path.join(tempDir, 'editor.html');

await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), left);
await fs.copyFile(path.join(root, 'samples', 'compare-right.html'), right);
await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), editorFile);

const electronApp = await electron.launch({
  args: [
    root,
    `--editor-file=${editorFile}`,
    `--compare-left=${left}`,
    `--compare-right=${right}`
  ]
});

async function editTextNode(frame, selector, replacement) {
  const target = frame.locator(selector).first();
  await target.waitFor();

  await target.evaluate((element, value) => {
    element.focus();
    element.textContent = value;
    element.blur();
  }, replacement);
}

function historyCount(text, name) {
  const match = new RegExp(`${name} \\((\\d+)\\)`).exec(text ?? '');
  return match ? Number(match[1]) : 0;
}

try {
  const page = await electronApp.firstWindow();

  await page.waitForFunction(() =>
    document.querySelector('#appVersion')?.textContent === 'v0.5.0'
  );
  assert.equal(await page.locator('#appVersion').textContent(), 'v0.5.0');

  await page.waitForSelector('#compareWorkspace:not(.hidden)');
  await page.waitForFunction(() => {
    const text = document.querySelector('#differenceCount')?.textContent ?? '';
    return /\d+\s*\/\s*\d+/.test(text);
  });

  const countText = await page.locator('#differenceCount').textContent();
  assert.match(countText ?? '', /\d+\s*\/\s*\d+/);

  const leftFrameHandle = await page.$('#compareLeftFrame');
  const rightFrameHandle = await page.$('#compareRightFrame');
  const leftFrame = await leftFrameHandle.contentFrame();
  const rightFrame = await rightFrameHandle.contentFrame();

  await leftFrame.waitForSelector('[data-hce-hunk]');
  await rightFrame.waitForSelector('[data-hce-hunk]');

  assert.ok(await leftFrame.locator('[data-hce-hunk]').count() > 0);
  assert.ok(await rightFrame.locator('[data-hce-hunk]').count() > 0);

  await page.waitForFunction(() => {
    const frames = [
      document.querySelector('#compareLeftFrame'),
      document.querySelector('#compareRightFrame')
    ];

    return frames.every((frame) => {
      const nodes = [...frame.contentDocument.querySelectorAll('.hce-active-diff')];
      if (nodes.length === 0) return false;

      const top = Math.min(...nodes.map((node) => node.getBoundingClientRect().top));
      const bottom = Math.max(...nodes.map((node) => node.getBoundingClientRect().bottom));
      return top >= -2 && bottom <= frame.clientHeight + 2;
    });
  });

  await page.waitForFunction(() =>
    document.querySelectorAll('#visualMergeGutter .visual-merge-pair').length === 1
  );

  const visualMergePairs = page.locator('#visualMergeGutter .visual-merge-pair');
  assert.equal(await visualMergePairs.first().locator('button').count(), 2);

  const visualPlacement = await page.evaluate(() => {
    const pair = document.querySelector('#visualMergeGutter .visual-merge-pair');
    const frames = [
      document.querySelector('#compareLeftFrame'),
      document.querySelector('#compareRightFrame')
    ];

    const activeCenters = frames.map((frame) => {
      const nodes = [...frame.contentDocument.querySelectorAll('.hce-active-diff')];
      const tops = nodes.map((node) => node.getBoundingClientRect().top);
      const bottoms = nodes.map((node) => node.getBoundingClientRect().bottom);
      const top = Math.min(...tops);
      const bottom = Math.max(...bottoms);
      return {
        top,
        bottom,
        viewportHeight: frame.clientHeight,
        outerCenter: frame.getBoundingClientRect().top + (top + bottom) / 2
      };
    });

    const pairRect = pair.getBoundingClientRect();
    return {
      activeCenters,
      pairCenter: (pairRect.top + pairRect.bottom) / 2,
      diffCenter: activeCenters.reduce((sum, item) => sum + item.outerCenter, 0) / activeCenters.length
    };
  });

  for (const placement of visualPlacement.activeCenters) {
    assert.ok(
      placement.top >= -2 && placement.bottom <= placement.viewportHeight + 2,
      `Active visual diff is not inside the viewport: ${JSON.stringify(placement)}`
    );
  }

  assert.ok(
    Math.abs(visualPlacement.pairCenter - visualPlacement.diffCenter) < 24,
    `Merge arrows are not aligned with the active diff: pair=${visualPlacement.pairCenter}, diff=${visualPlacement.diffCenter}`
  );

  await page.screenshot({
    path: path.join(outputDir, 'compare-visual.png'),
    fullPage: true
  });

  await page.waitForTimeout(300);
  await leftFrame.evaluate(() => {
    const scroller = document.scrollingElement;
    scroller.scrollTop = Math.min(900, scroller.scrollHeight - scroller.clientHeight);
  });

  await page.waitForTimeout(350);

  const firstRightTop = await rightFrame.evaluate(() => document.scrollingElement.scrollTop);
  assert.ok(firstRightTop > 100, `Expected right pane to follow left pane, got ${firstRightTop}`);

  await page.waitForTimeout(350);
  const secondRightTop = await rightFrame.evaluate(() => document.scrollingElement.scrollTop);
  assert.ok(
    Math.abs(secondRightTop - firstRightTop) < 8,
    `Synced scroll bounced: ${firstRightTop} -> ${secondRightTop}`
  );

  // Both Visual Compare panes are directly editable and participate in one history.
  await editTextNode(
    leftFrame,
    '[data-hce-compare-id]:has-text("This introduction is the same on both pages.")',
    'Left introduction edited in Visual Compare.'
  );

  await page.waitForFunction(() =>
    !document.querySelector('#compareLeftDirty')?.classList.contains('hidden') &&
    /Undo \(1\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? '')
  );

  await editTextNode(
    rightFrame,
    '[data-hce-compare-id]:has-text("This final section is the same on both pages.")',
    'Right final section edited in Visual Compare.'
  );

  await page.waitForFunction(() =>
    !document.querySelector('#compareRightDirty')?.classList.contains('hidden') &&
    /Undo \(2\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? '')
  );

  await page.locator('#compareUndoButton').click();
  await page.waitForFunction(() => /Undo \(1\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? ''));
  await page.locator('#compareUndoButton').click();
  await page.waitForFunction(() => document.querySelector('#compareUndoButton')?.disabled === true);
  assert.match(await page.locator('#compareRedoButton').textContent() ?? '', /Redo \(2\)/);

  await page.locator('#compareRedoButton').click();
  await page.waitForFunction(() => /Undo \(1\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? ''));
  await page.locator('#compareRedoButton').click();
  await page.waitForFunction(() => /Undo \(2\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? ''));

  assert.ok(await leftFrame.locator('text=Left introduction edited in Visual Compare.').count() > 0);
  assert.ok(await rightFrame.locator('text=Right final section edited in Visual Compare.').count() > 0);

  await page.locator('#saveCompareLeftButton').click();
  await page.waitForFunction(() => document.querySelector('#compareLeftDirty')?.classList.contains('hidden'));
  await page.locator('#saveCompareRightButton').click();
  await page.waitForFunction(() => document.querySelector('#compareRightDirty')?.classList.contains('hidden'));

  const baseHistoryCount = historyCount(await page.locator('#compareUndoButton').textContent(), 'Undo');
  assert.equal(baseHistoryCount, 2);

  await page.locator('[data-compare-view="source"]').click();
  await page.waitForSelector('#sourceCompare:not(.hidden) .source-row[data-hunk-id]');

  assert.ok(await page.locator('#sourceCompare .source-row[data-hunk-id]').count() > 0);

  const sourceMergePairs = page.locator('#sourceCompare .source-merge-pair');
  assert.ok(await sourceMergePairs.count() >= 2, 'Expected multiple diff-local merge controls in Source view');

  const railValidation = await page.evaluate(() => {
    const container = document.querySelector('#sourceCompare');
    const rows = [...container.querySelectorAll('.source-row')];
    const hunkIds = [];
    for (const row of rows) {
      const id = row.dataset.hunkId;
      if (id && !hunkIds.includes(id)) hunkIds.push(id);
    }

    const markers = [...document.querySelectorAll('#differenceRail button')];
    const containerRect = container.getBoundingClientRect();

    return hunkIds.map((id, index) => {
      const hunkRows = [...container.querySelectorAll(`[data-hunk-id="${id}"]`)];
      const tops = hunkRows.map(
        (row) => row.getBoundingClientRect().top - containerRect.top + container.scrollTop
      );
      const bottoms = hunkRows.map(
        (row) => row.getBoundingClientRect().bottom - containerRect.top + container.scrollTop
      );
      const center = (Math.min(...tops) + Math.max(...bottoms)) / 2;
      const expected = center / container.scrollHeight * 100;
      const actual = Number.parseFloat(markers[index]?.style.top ?? 'NaN');
      return { expected, actual };
    });
  });

  for (const { expected, actual } of railValidation) {
    assert.ok(Number.isFinite(actual));
    assert.ok(
      Math.abs(actual - expected) < 3,
      `Difference rail marker is not tied to the actual diff location: expected ${expected}, got ${actual}`
    );
  }

  await page.screenshot({
    path: path.join(outputDir, 'compare-source.png'),
    fullPage: true
  });

  const initialSource = await fs.readFile(right, 'utf8');

  for (let mergeIndex = 0; mergeIndex < 2; mergeIndex += 1) {
    const rightArrow = page.locator('#sourceCompare .source-merge-pair button').filter({ hasText: '→' }).first();
    await rightArrow.click();
    await page.waitForTimeout(150);
  }

  await page.waitForFunction((expected) => {
    const text = document.querySelector('#compareUndoButton')?.textContent ?? '';
    return text.includes(`Undo (${expected})`);
  }, baseHistoryCount + 2);

  await page.locator('#compareUndoButton').click();
  await page.locator('#compareUndoButton').click();

  await page.waitForFunction((expected) => {
    const text = document.querySelector('#compareUndoButton')?.textContent ?? '';
    return text.includes(`Undo (${expected})`);
  }, baseHistoryCount);
  assert.match(await page.locator('#compareRedoButton').textContent() ?? '', /Redo \(2\)/);

  await page.locator('#compareRedoButton').click();
  await page.waitForFunction((expected) => {
    const text = document.querySelector('#compareUndoButton')?.textContent ?? '';
    return text.includes(`Undo (${expected})`);
  }, baseHistoryCount + 1);

  await page.locator('#saveCompareRightButton').click();
  await page.waitForFunction(() => document.querySelector('#compareRightDirty')?.classList.contains('hidden'));

  const savedSource = await fs.readFile(right, 'utf8');
  assert.notEqual(savedSource, initialSource, 'Expected redo result to be saved to the right file');

  // Editor mode: Edit is interactive, Preview is helper-free/read-only, Diff has its own rail/navigation.
  await page.locator('[data-workspace-mode="editor"]').click();
  await page.waitForSelector('#workspace:not(.hidden)');
  await page.locator('[data-mode="edit"]').click();

  const editorFrameHandle = await page.$('#pageFrame');
  const editorFrame = await editorFrameHandle.contentFrame();
  await editorFrame.waitForSelector('[data-hce-id]');

  assert.equal(await page.locator('#editorModeHint').textContent(), 'Editable view');

  await editTextNode(
    editorFrame,
    '[data-hce-id]:has-text("HTML Compare Demo")',
    'HTML Compare Demo Edited'
  );
  await editTextNode(
    editorFrame,
    '[data-hce-id]:has-text("TTFA is measured before the first audio frame.")',
    'TTFA is now measured before the first audio frame.'
  );

  await page.waitForFunction(() =>
    !document.querySelector('#dirtyBadge')?.classList.contains('hidden')
  );

  await page.locator('[data-mode="preview"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#editorModeHint')?.textContent === 'Final render · read-only'
  );
  assert.equal(await editorFrame.locator('[data-hce-id]').count(), 0);
  assert.ok(await editorFrame.locator('text=HTML Compare Demo Edited').count() > 0);

  await page.locator('[data-mode="edit"]').click();
  await page.waitForFunction(() =>
    document.querySelector('#editorModeHint')?.textContent === 'Editable view'
  );
  await editorFrame.waitForSelector('[data-hce-id]');

  await page.locator('[data-mode="diff"]').click();
  await page.waitForSelector('#diffHost:not(.hidden)');

  await page.waitForFunction(() => {
    const text = document.querySelector('#editorDifferenceCount')?.textContent ?? '';
    return /1\s*\/\s*\d+/.test(text) &&
      document.querySelectorAll('#editorDiffRail button').length >= 2;
  });

  const editorRailCount = await page.locator('#editorDiffRail button').count();
  assert.ok(editorRailCount >= 2, 'Expected multiple editor diff rail markers');

  const editorRailValidation = await page.evaluate(() => {
    const panel = document.querySelector('#diffPanel');
    const markers = [...document.querySelectorAll('#editorDiffRail button')];
    const hunkIds = [];

    for (const row of panel.querySelectorAll('[data-editor-hunk-id]')) {
      const id = row.dataset.editorHunkId;
      if (id && !hunkIds.includes(id)) hunkIds.push(id);
    }

    const panelRect = panel.getBoundingClientRect();

    return hunkIds.map((id, index) => {
      const rows = [...panel.querySelectorAll(`[data-editor-hunk-id="${id}"]`)];
      const tops = rows.map(
        (row) => row.getBoundingClientRect().top - panelRect.top + panel.scrollTop
      );
      const bottoms = rows.map(
        (row) => row.getBoundingClientRect().bottom - panelRect.top + panel.scrollTop
      );
      const center = (Math.min(...tops) + Math.max(...bottoms)) / 2;
      return {
        expected: center / panel.scrollHeight * 100,
        actual: Number.parseFloat(markers[index]?.style.top ?? 'NaN')
      };
    });
  });

  for (const { expected, actual } of editorRailValidation) {
    assert.ok(Number.isFinite(actual));
    assert.ok(
      Math.abs(actual - expected) < 3,
      `Editor diff rail marker is not tied to the rendered diff: expected ${expected}, got ${actual}`
    );
  }

  const firstEditorDiffCount = await page.locator('#editorDifferenceCount').textContent();
  await page.locator('#editorNextDifferenceButton').click();
  await page.waitForFunction((before) =>
    document.querySelector('#editorDifferenceCount')?.textContent !== before
  , firstEditorDiffCount);

  assert.ok(await page.locator('#diffPanel .editor-diff-row.active-hunk').count() > 0);

  await page.screenshot({
    path: path.join(outputDir, 'editor-diff.png'),
    fullPage: true
  });

  await page.locator('#saveButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#dirtyBadge')?.classList.contains('hidden')
  );
} finally {
  await electronApp.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

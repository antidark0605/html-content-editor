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
await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), left);
await fs.copyFile(path.join(root, 'samples', 'compare-right.html'), right);

const electronApp = await electron.launch({
  args: [
    root,
    `--compare-left=${left}`,
    `--compare-right=${right}`
  ]
});

try {
  const page = await electronApp.firstWindow();
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

  const leftHunks = await leftFrame.locator('[data-hce-hunk]').count();
  const rightHunks = await rightFrame.locator('[data-hce-hunk]').count();
  assert.ok(leftHunks > 0);
  assert.ok(rightHunks > 0);

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

  const activeLeft = await leftFrame.locator('.hce-active-diff').count();
  const activeRight = await rightFrame.locator('.hce-active-diff').count();
  assert.ok(activeLeft > 0);
  assert.ok(activeRight > 0);

  await page.waitForFunction(() =>
    document.querySelectorAll('#visualMergeGutter .visual-merge-pair').length > 0
  );
  const visualMergePairs = page.locator('#visualMergeGutter .visual-merge-pair');
  assert.ok(await visualMergePairs.count() > 0, 'Expected merge arrows beside visible differences');
  assert.equal(await visualMergePairs.count(), 1, 'Visual view should show merge arrows only for the active diff');
  assert.ok(await visualMergePairs.first().locator('button').count() === 2);

  const visualPlacement = await page.evaluate(() => {
    const pair = document.querySelector('#visualMergeGutter .visual-merge-pair');
    const frames = [
      document.querySelector('#compareLeftFrame'),
      document.querySelector('#compareRightFrame')
    ];

    const activeCenters = frames.map((frame) => {
      const doc = frame.contentDocument;
      const nodes = [...doc.querySelectorAll('.hce-active-diff')];
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

  await page.locator('[data-compare-view="source"]').click();
  await page.waitForSelector('#sourceCompare:not(.hidden) .source-row[data-hunk-id]');

  const sourceRows = await page.locator('#sourceCompare .source-row[data-hunk-id]').count();
  assert.ok(sourceRows > 0);

  const sourceMergePairs = page.locator('#sourceCompare .source-merge-pair');
  const pairCount = await sourceMergePairs.count();
  assert.ok(pairCount >= 2, 'Expected multiple diff-local merge controls in Source view');

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

  await page.waitForFunction(() => {
    const button = document.querySelector('#compareUndoButton');
    return /Undo \(2\)/.test(button?.textContent ?? '');
  });
  assert.equal(await page.locator('#compareUndoButton').isEnabled(), true);
  assert.equal(await page.locator('#compareRedoButton').isEnabled(), false);

  await page.locator('#compareUndoButton').click();
  await page.locator('#compareUndoButton').click();

  await page.waitForFunction(() => document.querySelector('#compareUndoButton')?.disabled === true);
  assert.match(await page.locator('#compareRedoButton').textContent() ?? '', /Redo \(2\)/);

  await page.locator('#compareRedoButton').click();
  await page.waitForFunction(() => /Undo \(1\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? ''));

  await page.locator('#saveCompareRightButton').click();
  await page.waitForFunction(() => document.querySelector('#compareRightDirty')?.classList.contains('hidden'));

  const savedSource = await fs.readFile(right, 'utf8');
  assert.notEqual(savedSource, initialSource, 'Expected redo result to be saved to the right file');
} finally {
  await electronApp.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

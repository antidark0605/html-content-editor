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

  await page.waitForTimeout(350);
  const activeLeft = await leftFrame.locator('.hce-active-diff').count();
  const activeRight = await rightFrame.locator('.hce-active-diff').count();
  assert.ok(activeLeft > 0);
  assert.ok(activeRight > 0);

  await page.screenshot({
    path: path.join(outputDir, 'compare-visual.png'),
    fullPage: true
  });

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

  const mergeButtons = await page.locator('#sourceCompare .source-gutter button').count();
  assert.ok(mergeButtons >= 2);

  await page.screenshot({
    path: path.join(outputDir, 'compare-source.png'),
    fullPage: true
  });

  const beforeMergeCount = await page.locator('#differenceCount').textContent();
  const firstRightArrow = page.locator('#sourceCompare .source-gutter button').filter({ hasText: '→' }).first();
  await firstRightArrow.click();

  await page.waitForFunction(() => !document.querySelector('#compareRightDirty')?.classList.contains('hidden'));
  assert.equal(await page.locator('#saveCompareRightButton').isEnabled(), true);

  const afterMergeCount = await page.locator('#differenceCount').textContent();
  assert.notEqual(afterMergeCount, beforeMergeCount);

  await page.locator('#saveCompareRightButton').click();
  await page.waitForFunction(() => document.querySelector('#compareRightDirty')?.classList.contains('hidden'));
  assert.equal(await page.locator('#saveCompareRightButton').isEnabled(), false);
} finally {
  await electronApp.close();
  await fs.rm(tempDir, { recursive: true, force: true });
}

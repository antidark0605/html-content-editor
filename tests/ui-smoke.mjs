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
const droppedEditor = path.join(tempDir, 'drop-editor.html');
const droppedLeft = path.join(tempDir, 'drop-left.html');
const droppedRight = path.join(tempDir, 'drop-right.html');
const alignmentLeft = path.join(tempDir, 'alignment-left.html');
const alignmentRight = path.join(tempDir, 'alignment-right.html');

await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), left);
await fs.copyFile(path.join(root, 'samples', 'compare-right.html'), right);
await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), editorFile);
await fs.copyFile(path.join(root, 'samples', 'compare-right.html'), droppedEditor);
await fs.copyFile(path.join(root, 'samples', 'compare-left.html'), droppedLeft);
await fs.copyFile(path.join(root, 'samples', 'compare-right.html'), droppedRight);

await fs.writeFile(alignmentLeft, [
  '<!doctype html><html><body><nav>',
  '<a href="#flows">06 · 配對、資料流與信任邊界</a>',
  '<a href="#comparison">07 · 兩套 SDK 比較</a>',
  '<a href="#market">08 · 生態與產品地圖</a>',
  '</nav></body></html>'
].join(''), 'utf8');

await fs.writeFile(alignmentRight, [
  '<!doctype html><html><body><nav>',
  '<a href="#flows">06 · 配對與資料流</a>',
  '<a href="#security">07 · 安全機制</a>',
  '<a href="#comparison">08 · 兩套 SDK 比較</a>',
  '<a href="#market">09 · 生態與產品地圖</a>',
  '</nav></body></html>'
].join(''), 'utf8');

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

async function selectTextRange(frame, selector, start, end) {
  const target = frame.locator(selector).first();
  await target.waitFor();

  await target.evaluate((element, offsets) => {
    const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (!textNode) throw new Error('Expected a direct text node for formatting test.');

    const range = document.createRange();
    range.setStart(textNode, offsets.start);
    range.setEnd(textNode, offsets.end);

    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}

async function setCaret(frame, selector, offset = null) {
  const target = frame.locator(selector).first();
  await target.waitFor();

  await target.evaluate((element, requestedOffset) => {
    element.focus();

    const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (!textNode) throw new Error('Expected a direct text node for caret test.');

    const caretOffset = requestedOffset === null
      ? textNode.nodeValue.length
      : requestedOffset;

    const range = document.createRange();
    range.setStart(textNode, caretOffset);
    range.collapse(true);

    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, offset);
}

function historyCount(text, name) {
  const match = new RegExp(`${name} \\((\\d+)\\)`).exec(text ?? '');
  return match ? Number(match[1]) : 0;
}

async function dropFile(page, filePath, target) {
  await page.evaluate(() => {
    document.querySelector('#uiDropInput')?.remove();
    const input = document.createElement('input');
    input.id = 'uiDropInput';
    input.type = 'file';
    input.hidden = true;
    document.body.append(input);
  });

  await page.locator('#uiDropInput').setInputFiles(filePath);

  await page.evaluate(() => {
    const input = document.querySelector('#uiDropInput');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(input.files[0]);
    document.dispatchEvent(new DragEvent('dragenter', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }));
  });

  await page.waitForSelector('#dropOverlay:not(.hidden)');

  await page.evaluate((dropTarget) => {
    const input = document.querySelector('#uiDropInput');
    const zone = document.querySelector(`[data-drop-target="${dropTarget}"]`);
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(input.files[0]);
    zone.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer
    }));
  }, target);

  await page.waitForFunction(() =>
    document.querySelector('#dropOverlay')?.classList.contains('hidden')
  );
}

try {
  const page = await electronApp.firstWindow();

  await page.waitForFunction(() =>
    document.querySelector('#appVersion')?.textContent === 'v0.9.0'
  );
  assert.equal(await page.locator('#appVersion').textContent(), 'v0.9.0');

  await page.locator('#aboutButton').click();
  await page.waitForSelector('#aboutDialog[open]');
  assert.equal(await page.locator('#aboutVersion').textContent(), 'Version 0.9.0');
  assert.match(await page.locator('#aboutBuild').textContent() ?? '', /^Build (development|[0-9a-f]{8})$/);
  assert.ok((await page.locator('#aboutElectron').textContent())?.length > 0);
  assert.ok((await page.locator('#aboutPlatform').textContent())?.includes('win32'));
  assert.equal(await page.locator('[data-about-link="project"]').count(), 1);
  assert.equal(await page.locator('[data-about-link="issues"]').count(), 1);
  assert.equal(await page.locator('[data-about-link="license"]').count(), 1);

  await page.screenshot({
    path: path.join(outputDir, 'about.png'),
    fullPage: true
  });

  await page.locator('#closeAboutButton').click();
  await page.waitForFunction(() => !document.querySelector('#aboutDialog')?.open);

  await page.waitForSelector('#compareWorkspace:not(.hidden)');
  await page.waitForFunction(() => {
    const text = document.querySelector('#differenceCount')?.textContent ?? '';
    return /\d+\s*\/\s*\d+/.test(text);
  });

  const countText = await page.locator('#differenceCount').textContent();
  assert.match(countText ?? '', /\d+\s*\/\s*\d+/);

  await page.locator('#copyCompareLeftPathButton').click();
  const copiedLeftPath = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copiedLeftPath, left);

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
  // Editing deep in the document must preserve the current viewport instead of jumping to the top.
  const deepLeftSelector = '[data-hce-compare-id]:has-text("This final section is the same on both pages.")';
  const deepLeftTarget = leftFrame.locator(deepLeftSelector).first();
  await deepLeftTarget.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);

  const beforeDeepEditScroll = await Promise.all([
    leftFrame.evaluate(() => document.scrollingElement.scrollTop),
    rightFrame.evaluate(() => document.scrollingElement.scrollTop)
  ]);
  assert.ok(beforeDeepEditScroll[0] > 500, `Expected deep left scroll before edit, got ${beforeDeepEditScroll[0]}`);

  await editTextNode(
    leftFrame,
    deepLeftSelector,
    'Left final section edited in Visual Compare.'
  );

  await page.waitForFunction(() =>
    !document.querySelector('#compareLeftDirty')?.classList.contains('hidden') &&
    /Undo \(1\)/.test(document.querySelector('#compareUndoButton')?.textContent ?? '')
  );

  await page.waitForTimeout(350);

  const afterDeepEditScroll = await Promise.all([
    leftFrame.evaluate(() => document.scrollingElement.scrollTop),
    rightFrame.evaluate(() => document.scrollingElement.scrollTop)
  ]);

  assert.ok(
    Math.abs(afterDeepEditScroll[0] - beforeDeepEditScroll[0]) < 120,
    `Left Compare viewport jumped after edit: ${beforeDeepEditScroll[0]} -> ${afterDeepEditScroll[0]}`
  );
  assert.ok(
    afterDeepEditScroll[0] > 500,
    `Left Compare unexpectedly returned near the top after edit: ${afterDeepEditScroll[0]}`
  );

  const editedLeftPlacement = await leftFrame.locator(
    '[data-hce-compare-id]:has-text("Left final section edited in Visual Compare.")'
  ).first().evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: document.documentElement.clientHeight
    };
  });
  assert.ok(
    editedLeftPlacement.bottom >= 0 && editedLeftPlacement.top <= editedLeftPlacement.viewportHeight,
    `Edited Compare text is no longer visible after rerender: ${JSON.stringify(editedLeftPlacement)}`
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

  assert.ok(await leftFrame.locator('text=Left final section edited in Visual Compare.').count() > 0);
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
  assert.equal(await page.locator('#formatToolbar').isVisible(), true);
  assert.equal(await page.locator('[data-text-format="bold"]').isDisabled(), true);

  // Rich text formatting is selection-based and patches only the selected text.
  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("HTML Compare Demo")',
    0,
    4
  );
  await page.waitForFunction(() => !document.querySelector('[data-text-format="bold"]')?.disabled);
  await page.locator('[data-text-format="bold"]').click();
  await editorFrame.waitForSelector('span[style*="font-weight: 700"]');
  assert.equal(
    await editorFrame.locator('span[style*="font-weight: 700"]').first().textContent(),
    'HTML'
  );

  // Formatting participates in the same Editor Undo/Redo history.
  await page.locator('#undoButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#redoButton')?.disabled === false
  );
  assert.equal(await editorFrame.locator('span[style*="font-weight: 700"]').count(), 0);

  await page.locator('#redoButton').click();
  await editorFrame.waitForSelector('span[style*="font-weight: 700"]');

  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("Compare Demo")',
    0,
    7
  );
  await page.locator('[data-text-format="italic"]').click();
  await editorFrame.waitForSelector('span[style*="font-style: italic"]');

  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("Demo")',
    0,
    4
  );
  await page.locator('[data-text-format="underline"]').click();
  await editorFrame.waitForSelector('span[style*="text-decoration: underline"]');

  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("HTML")',
    0,
    4
  );
  await page.locator('#formatFontSize').selectOption('20px');
  await editorFrame.waitForSelector('span[style*="font-size: 20px"]');

  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("HTML")',
    0,
    4
  );
  await page.locator('#textColorButton').click();
  await page.waitForSelector('#colorPalette:not(.hidden)');
  await page.locator('#colorPalette .color-swatch[data-color="#c00000"]').click();
  await editorFrame.waitForSelector('span[style*="color: #c00000"]');

  await selectTextRange(
    editorFrame,
    '[data-hce-id]:has-text("HTML")',
    0,
    4
  );
  await page.locator('#backgroundColorButton').click();
  await page.waitForSelector('#colorPalette:not(.hidden)');
  await page.locator('#colorPalette .color-swatch[data-color="#fce4d6"]').click();
  await editorFrame.waitForSelector('span[style*="background-color: #fce4d6"]');

  // With no selection, a caret color choice styles only newly typed text.
  const caretSelector = '[data-hce-id]:has-text("RTF is lower when precomputed voices are used.")';
  await setCaret(editorFrame, caretSelector);

  await page.waitForFunction(() =>
    document.querySelector('#formatSelectionHint')?.textContent?.includes('Caret ready')
  );

  await page.locator('#textColorButton').click();
  await page.locator('#colorPalette .color-swatch[data-color="#0070c0"]').click();

  await page.locator('#backgroundColorButton').click();
  await page.locator('#colorPalette .color-swatch[data-color="#d9eaf7"]').first().click();

  const transientTypingSpan = editorFrame.locator('[data-hce-typing-style]').last();
  await transientTypingSpan.waitFor();
  assert.equal(await transientTypingSpan.getAttribute('data-hce-color'), '#0070c0');
  assert.equal(await transientTypingSpan.getAttribute('data-hce-background-color'), '#d9eaf7');

  await page.keyboard.type(' COLORED');
  assert.equal(
    await transientTypingSpan.textContent(),
    ' COLORED',
    'Expected keyboard input to remain inside the active caret-style span'
  );

  await page.locator('#fileName').click();

  await editorFrame.waitForSelector(
    'span[style*="color: #0070c0"][style*="background-color: #d9eaf7"]'
  );
  assert.equal(
    await editorFrame.locator(
      'span[style*="color: #0070c0"][style*="background-color: #d9eaf7"]'
    ).last().textContent(),
    ' COLORED'
  );

  await page.screenshot({
    path: path.join(outputDir, 'editor-formatting.png'),
    fullPage: true
  });

  // Basic table editing: create a simple table, edit rows/columns, delete it, then undo.
  await editorFrame.locator('[data-hce-id]:has-text("Notes")').first().click();
  await page.locator('#insertTableButton').click();
  await page.waitForSelector('#insertTableDialog[open]');
  await page.locator('#insertTableRows').fill('2');
  await page.locator('#insertTableColumns').fill('3');
  await page.locator('#confirmInsertTableButton').click();

  await editorFrame.waitForSelector('table');
  assert.equal(await editorFrame.locator('table').count(), 1);
  assert.equal(await editorFrame.locator('table tr').count(), 2);
  assert.equal(await editorFrame.locator('table tr').first().locator('td, th').count(), 3);

  await editorFrame.locator('table tr').first().locator('td, th').first().click();
  await page.waitForSelector('#tableContextTools:not(.hidden)');
  assert.match(await page.locator('#tableSelectionHint').textContent() ?? '', /2 × 3/);

  await page.locator('#insertRowBelowButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelectorAll('table tr').length === 3
  );

  await editorFrame.locator('table tr').first().locator('td, th').first().click();
  await page.locator('#insertColumnRightButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelector('table tr')?.cells?.length === 4
  );

  await editorFrame.locator('table tr').nth(1).locator('td, th').first().click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#deleteRowButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelectorAll('table tr').length === 2
  );

  await editorFrame.locator('table tr').first().locator('td, th').nth(1).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#deleteColumnButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelector('table tr')?.cells?.length === 3
  );

  await page.screenshot({
    path: path.join(outputDir, 'editor-table.png'),
    fullPage: true
  });

  await editorFrame.locator('table tr').first().locator('td, th').first().click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('#deleteTableButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelectorAll('table').length === 0
  );

  await page.locator('#undoButton').click();
  await page.waitForFunction(() =>
    document.querySelector('#pageFrame')?.contentDocument?.querySelectorAll('table').length === 1
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
  assert.ok(await editorFrame.locator('text=TTFA is now measured before the first audio frame.').count() > 0);
  assert.ok(await editorFrame.locator('span[style*="font-weight: 700"]').count() > 0);

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

  await page.locator('#copyEditorPathButton').click();
  const copiedEditorPath = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copiedEditorPath, editorFile);

  await dropFile(page, droppedEditor, 'editor');
  await page.waitForFunction((name) =>
    document.querySelector('#fileName')?.textContent === name
  , path.basename(droppedEditor));
  assert.equal(await page.locator('#fileName').textContent(), path.basename(droppedEditor));

  await page.locator('[data-workspace-mode="compare"]').click();
  await page.waitForSelector('#compareWorkspace:not(.hidden)');

  await dropFile(page, droppedLeft, 'left');
  await page.waitForFunction((name) =>
    document.querySelector('#compareLeftName')?.textContent === name
  , path.basename(droppedLeft));

  await dropFile(page, droppedRight, 'right');
  await page.waitForFunction((name) =>
    document.querySelector('#compareRightName')?.textContent === name
  , path.basename(droppedRight));

  await page.locator('#copyCompareRightPathButton').click();
  const copiedRightPath = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
  assert.equal(copiedRightPath, droppedRight);

  await page.screenshot({
    path: path.join(outputDir, 'drag-drop.png'),
    fullPage: true
  });

  // Regression: an inserted TOC entry must not make neighboring stable links unmergeable.
  await dropFile(page, alignmentLeft, 'left');
  await dropFile(page, alignmentRight, 'right');
  await page.locator('[data-compare-view="visual"]').click();

  await page.waitForFunction(() =>
    document.querySelector('#differenceCount')?.textContent === '1 / 4' &&
    document.querySelectorAll('#visualMergeGutter .visual-merge-pair button').length === 2
  );

  let regressionButtons = page.locator('#visualMergeGutter .visual-merge-pair button');
  assert.equal(await regressionButtons.nth(0).isDisabled(), false);
  assert.equal(await regressionButtons.nth(1).isDisabled(), false);

  await page.locator('#nextDifferenceButton').click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('#visualMergeGutter .visual-merge-pair button')];
    return document.querySelector('#differenceCount')?.textContent === '2 / 4' &&
      buttons.length === 2 &&
      buttons.every((button) => button.disabled);
  });

  regressionButtons = page.locator('#visualMergeGutter .visual-merge-pair button');
  assert.equal(await regressionButtons.nth(0).isDisabled(), true);
  assert.equal(await regressionButtons.nth(1).isDisabled(), true);

  await page.locator('#nextDifferenceButton').click();
  await page.waitForFunction(() => {
    const buttons = [...document.querySelectorAll('#visualMergeGutter .visual-merge-pair button')];
    return document.querySelector('#differenceCount')?.textContent === '3 / 4' &&
      buttons.length === 2 &&
      buttons.every((button) => !button.disabled);
  });

  regressionButtons = page.locator('#visualMergeGutter .visual-merge-pair button');
  assert.equal(await regressionButtons.nth(0).isDisabled(), false);
  assert.equal(await regressionButtons.nth(1).isDisabled(), false);

  await page.screenshot({
    path: path.join(outputDir, 'compare-visual-insert-alignment.png'),
    fullPage: true
  });
} finally {
  // Force-exit in test teardown so a failed assertion cannot hang CI behind
  // the native unsaved-changes dialog.
  try {
    await electronApp.evaluate(({ app }) => app.exit(0));
  } catch {
    // The evaluation can race with process shutdown; either way the app is exiting.
  }
  await fs.rm(tempDir, { recursive: true, force: true });
}

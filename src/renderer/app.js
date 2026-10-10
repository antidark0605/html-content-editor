import {
  clampZoom,
  COMPARE_ZOOM_STEP,
  mapAlignedPosition,
  scrollRatio,
  scrollTopForRatio
} from '../compare-utils.mjs';

const elements = {
  openButton: document.querySelector('#openButton'),
  welcomeOpenButton: document.querySelector('#welcomeOpenButton'),
  saveButton: document.querySelector('#saveButton'),
  saveAsButton: document.querySelector('#saveAsButton'),
  editorFileActions: document.querySelector('#editorFileActions'),
  workspaceModeButtons: [...document.querySelectorAll('[data-workspace-mode]')],
  editorTools: document.querySelector('#editorTools'),
  compareTools: document.querySelector('#compareTools'),
  compareViewButtons: [...document.querySelectorAll('[data-compare-view]')],
  undoButton: document.querySelector('#undoButton'),
  redoButton: document.querySelector('#redoButton'),
  searchInput: document.querySelector('#searchInput'),
  searchNextButton: document.querySelector('#searchNextButton'),
  searchCount: document.querySelector('#searchCount'),
  welcome: document.querySelector('#welcome'),
  workspace: document.querySelector('#workspace'),
  fileName: document.querySelector('#fileName'),
  dirtyBadge: document.querySelector('#dirtyBadge'),
  editableCount: document.querySelector('#editableCount'),
  scriptWarning: document.querySelector('#scriptWarning'),
  frameHost: document.querySelector('#frameHost'),
  pageFrame: document.querySelector('#pageFrame'),
  diffPanel: document.querySelector('#diffPanel'),
  compareWorkspace: document.querySelector('#compareWorkspace'),
  visualCompare: document.querySelector('#visualCompare'),
  sourceCompare: document.querySelector('#sourceCompare'),
  differenceRail: document.querySelector('#differenceRail'),
  compareLeftFrame: document.querySelector('#compareLeftFrame'),
  compareRightFrame: document.querySelector('#compareRightFrame'),
  compareLeftName: document.querySelector('#compareLeftName'),
  compareRightName: document.querySelector('#compareRightName'),
  compareLeftDirty: document.querySelector('#compareLeftDirty'),
  compareRightDirty: document.querySelector('#compareRightDirty'),
  compareLeftScriptWarning: document.querySelector('#compareLeftScriptWarning'),
  compareRightScriptWarning: document.querySelector('#compareRightScriptWarning'),
  openCompareLeftButton: document.querySelector('#openCompareLeftButton'),
  openCompareRightButton: document.querySelector('#openCompareRightButton'),
  reloadCompareLeftButton: document.querySelector('#reloadCompareLeftButton'),
  reloadCompareRightButton: document.querySelector('#reloadCompareRightButton'),
  saveCompareLeftButton: document.querySelector('#saveCompareLeftButton'),
  saveCompareRightButton: document.querySelector('#saveCompareRightButton'),
  swapCompareButton: document.querySelector('#swapCompareButton'),
  previousDifferenceButton: document.querySelector('#previousDifferenceButton'),
  nextDifferenceButton: document.querySelector('#nextDifferenceButton'),
  differenceCount: document.querySelector('#differenceCount'),
  compareUndoButton: document.querySelector('#compareUndoButton'),
  compareRedoButton: document.querySelector('#compareRedoButton'),
  visualMergeGutter: document.querySelector('#visualMergeGutter'),
  syncScrollLabel: document.querySelector('#syncScrollLabel'),
  syncScrollCheckbox: document.querySelector('#syncScrollCheckbox'),
  zoomControls: document.querySelector('#zoomControls'),
  zoomOutButton: document.querySelector('#zoomOutButton'),
  zoomResetButton: document.querySelector('#zoomResetButton'),
  zoomInButton: document.querySelector('#zoomInButton'),
  zoomLabel: document.querySelector('#zoomLabel'),
  modeButtons: [...document.querySelectorAll('[data-mode]')],
  toast: document.querySelector('#toast')
};

const state = {
  session: null,
  edits: {},
  workingSource: '',
  mode: 'edit',
  undoStack: [],
  redoStack: [],
  searchMatches: [],
  searchIndex: -1,
  pendingCommit: Promise.resolve(),
  workspaceMode: 'editor',
  compare: { left: null, right: null },
  compareAnalysis: null,
  compareHistory: { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 },
  compareView: 'visual',
  activeDifferenceIndex: 0,
  compareZoom: 1,
  syncScroll: true,
  compareFrameReady: { left: false, right: false },
  alignmentPoints: [],
  scrollDriver: null,
  scrollDriverTimer: null,
  programmaticUntil: { left: 0, right: 0 },
  pendingInitialDifferenceScroll: false
};

function escapeHtmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function injectIntoHead(html, addition) {
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}${addition}`);
  }

  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(
      /<html\b[^>]*>/i,
      (match) => `${match}<head>${addition}</head>`
    );
  }

  return `<head>${addition}</head>${html}`;
}

function baseTagFor(source, baseHref) {
  if (/<base\b/i.test(source ?? '')) return '';
  return `<base href="${escapeAttribute(baseHref ?? '')}">`;
}

function baseTag() {
  return baseTagFor(state.session.source, state.session.baseHref);
}

function editorStyle() {
  return `<style data-hce-editor-style>
    [data-hce-id] {
      cursor: text !important;
      outline: 1px dashed transparent !important;
      outline-offset: 2px !important;
      border-radius: 2px !important;
    }
    [data-hce-id]:hover {
      outline-color: #1f6feb !important;
      background: rgba(31, 111, 235, 0.08) !important;
    }
    [data-hce-id]:focus {
      outline: 2px solid #1f6feb !important;
      background: rgba(31, 111, 235, 0.10) !important;
    }
    [data-hce-id].hce-search-hit {
      outline: 2px solid #d97706 !important;
      background: rgba(245, 158, 11, 0.24) !important;
    }
  </style>`;
}

function compareStyle() {
  return `<style data-hce-compare-style>
    .hce-compare-node {
      border-radius: 2px !important;
      transition: outline-color 80ms linear !important;
    }
    .hce-compare-changed {
      background: rgba(245, 158, 11, 0.20) !important;
      box-shadow: inset 0 -2px rgba(217, 119, 6, 0.35) !important;
    }
    .hce-compare-removed {
      background: rgba(248, 81, 73, 0.20) !important;
      box-shadow: inset 0 -2px rgba(220, 38, 38, 0.35) !important;
    }
    .hce-compare-added {
      background: rgba(46, 160, 67, 0.20) !important;
      box-shadow: inset 0 -2px rgba(22, 163, 74, 0.35) !important;
    }
    .hce-inline-left {
      background: rgba(248, 81, 73, 0.34) !important;
      border-radius: 2px !important;
    }
    .hce-inline-right {
      background: rgba(46, 160, 67, 0.34) !important;
      border-radius: 2px !important;
    }
    .hce-active-diff {
      outline: 2px solid #1f6feb !important;
      outline-offset: 2px !important;
    }
  </style>`;
}

function buildEditableDocument() {
  const { source, textNodes } = state.session;
  const parts = [];
  let cursor = 0;

  for (const node of textNodes) {
    parts.push(source.slice(cursor, node.start));

    const content = Object.hasOwn(state.edits, node.id)
      ? escapeHtmlText(state.edits[node.id])
      : source.slice(node.start, node.end);

    parts.push(
      `<span data-hce-id="${node.id}" contenteditable="plaintext-only" spellcheck="false">${content}</span>`
    );
    cursor = node.end;
  }

  parts.push(source.slice(cursor));

  return injectIntoHead(parts.join(''), `${baseTag()}${editorStyle()}`);
}

function buildPreviewDocument() {
  return injectIntoHead(state.workingSource, baseTag());
}

function emptyCompareDocument(side) {
  const label = side === 'left' ? 'Left' : 'Right';
  return '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#8a94a6;font:14px system-ui,sans-serif}.card{text-align:center;padding:24px}.card strong{display:block;color:#536071;margin-bottom:6px}</style></head><body><div class="card"><strong>' + label + ' page</strong>Open an HTML file to compare.</div></body></html>';
}

function buildCompareDocument(side) {
  const page = state.compare[side];
  if (!page) return emptyCompareDocument(side);

  const instrumented = state.compareAnalysis?.visual
    ? side === 'left'
      ? state.compareAnalysis.visual.leftHtml
      : state.compareAnalysis.visual.rightHtml
    : page.source;

  return injectIntoHead(
    instrumented,
    `${baseTagFor(page.source, page.baseHref)}${compareStyle()}`
  );
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3400);
}

function setDirty(dirty) {
  if (!state.session) return;
  state.session.dirty = dirty;
  elements.dirtyBadge.classList.toggle('hidden', !dirty);
  elements.saveButton.disabled = !dirty;
}

function updateHistoryButtons() {
  elements.undoButton.disabled = state.undoStack.length === 0;
  elements.redoButton.disabled = state.redoStack.length === 0;
}

function nodeById(id) {
  return state.session.textNodes.find((node) => node.id === id);
}

function currentValueFor(id) {
  const node = nodeById(id);
  if (!node) return '';
  return Object.hasOwn(state.edits, id) ? state.edits[id] : node.text;
}

async function rebuildWorkingSource() {
  const result = await window.hce.applyEdits(state.edits);
  state.workingSource = result.workingSource;
  setDirty(result.dirty);
}

async function recordEdit(id, value, beforeOverride = null) {
  const node = nodeById(id);
  if (!node) return;

  const before = beforeOverride ?? currentValueFor(id);
  if (value === before) return;

  state.undoStack.push({ id, before, after: value });
  state.redoStack.length = 0;

  if (value === node.text) {
    delete state.edits[id];
  } else {
    state.edits[id] = value;
  }

  await rebuildWorkingSource();
  updateHistoryButtons();
}

async function commitEditableElement(editable) {
  if (!editable?.matches?.('[data-hce-id]')) return;

  const id = editable.dataset.hceId;
  const before = editable.dataset.hceBefore ?? currentValueFor(id);
  const after = editable.textContent ?? before;

  if (after !== before) {
    await recordEdit(id, after, before);
    editable.dataset.hceBefore = after;
  }
}

function queueEditableCommit(editable) {
  state.pendingCommit = state.pendingCommit
    .catch(() => {})
    .then(() => commitEditableElement(editable));

  return state.pendingCommit;
}

async function flushPendingEdits() {
  const active = elements.pageFrame.contentDocument?.activeElement;

  if (active?.matches?.('[data-hce-id]')) {
    await queueEditableCommit(active);
    active.blur();
  }

  await state.pendingCommit;
}

function wireEditableFrame() {
  const doc = elements.pageFrame.contentDocument;
  if (!doc) return;

  doc.addEventListener(
    'click',
    (event) => {
      const anchor = event.target.closest?.('a');
      if (anchor) event.preventDefault();
    },
    true
  );

  for (const editable of doc.querySelectorAll('[data-hce-id]')) {
    editable.addEventListener('focus', () => {
      editable.dataset.hceBefore = editable.textContent ?? '';
    });

    editable.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        editable.textContent = editable.dataset.hceBefore ?? editable.textContent;
        editable.blur();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        editable.blur();
      }
    });

    editable.addEventListener('blur', () => {
      void queueEditableCommit(editable);
    });
  }

  runSearch(false);
}

function renderEdit() {
  elements.diffPanel.classList.add('hidden');
  elements.frameHost.classList.remove('hidden');
  elements.pageFrame.setAttribute('sandbox', 'allow-same-origin');
  elements.pageFrame.onload = wireEditableFrame;
  elements.pageFrame.srcdoc = buildEditableDocument();
  elements.searchInput.disabled = false;
  elements.searchNextButton.disabled = !elements.searchInput.value;
}

function renderPreview() {
  elements.diffPanel.classList.add('hidden');
  elements.frameHost.classList.remove('hidden');
  elements.pageFrame.onload = null;
  elements.pageFrame.setAttribute('sandbox', 'allow-same-origin');
  elements.pageFrame.srcdoc = buildPreviewDocument();
  elements.searchInput.disabled = true;
  elements.searchNextButton.disabled = true;
  elements.searchCount.textContent = '';
}

async function renderDiff() {
  elements.frameHost.classList.add('hidden');
  elements.diffPanel.classList.remove('hidden');
  elements.searchInput.disabled = true;
  elements.searchNextButton.disabled = true;
  elements.searchCount.textContent = '';

  const parts = await window.hce.diff(state.workingSource);
  elements.diffPanel.replaceChildren();

  if (!parts.some((part) => part.added || part.removed)) {
    const empty = document.createElement('div');
    empty.textContent = 'No changes yet.';
    empty.className = 'diff-line context';
    elements.diffPanel.append(empty);
    return;
  }

  for (const part of parts) {
    const line = document.createElement('span');
    line.className = `diff-line ${part.added ? 'added' : part.removed ? 'removed' : 'context'}`;
    const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
    line.textContent = prefix + part.value;
    elements.diffPanel.append(line);
  }
}

async function setMode(mode) {
  if (!state.session) return;

  await flushPendingEdits();

  state.mode = mode;
  for (const button of elements.modeButtons) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }

  if (mode === 'edit') renderEdit();
  if (mode === 'preview') renderPreview();
  if (mode === 'diff') await renderDiff();
}

function refreshWorkspaceVisibility() {
  const editorActive = state.workspaceMode === 'editor';

  elements.editorFileActions.classList.toggle('hidden', !editorActive);
  elements.editorTools.classList.toggle('hidden', !editorActive);
  elements.compareTools.classList.toggle('hidden', editorActive);
  elements.compareWorkspace.classList.toggle('hidden', editorActive);

  if (editorActive) {
    elements.welcome.classList.toggle('hidden', Boolean(state.session));
    elements.workspace.classList.toggle('hidden', !state.session);
  } else {
    elements.welcome.classList.add('hidden');
    elements.workspace.classList.add('hidden');
  }

  for (const button of elements.workspaceModeButtons) {
    button.classList.toggle('active', button.dataset.workspaceMode === state.workspaceMode);
  }
}

async function setWorkspaceMode(mode) {
  if (mode !== 'editor' && mode !== 'compare') return;
  if (state.workspaceMode === 'editor' && mode !== 'editor' && state.session) {
    await flushPendingEdits();
  }

  state.workspaceMode = mode;
  refreshWorkspaceVisibility();
  if (mode === 'compare') renderCompare();
}

function compareElementsFor(side) {
  if (side === 'left') {
    return {
      frame: elements.compareLeftFrame,
      name: elements.compareLeftName,
      dirty: elements.compareLeftDirty,
      warning: elements.compareLeftScriptWarning,
      reload: elements.reloadCompareLeftButton,
      save: elements.saveCompareLeftButton
    };
  }

  return {
    frame: elements.compareRightFrame,
    name: elements.compareRightName,
    dirty: elements.compareRightDirty,
    warning: elements.compareRightScriptWarning,
    reload: elements.reloadCompareRightButton,
    save: elements.saveCompareRightButton
  };
}

function updateCompareHeader(side) {
  const page = state.compare[side];
  const controls = compareElementsFor(side);
  controls.name.textContent = page?.fileName ?? 'No file open';
  controls.name.title = page?.filePath ?? '';
  controls.dirty.classList.toggle('hidden', !page?.dirty);
  controls.warning.classList.toggle('hidden', !page?.hasScripts || state.compareView === 'source');
  controls.reload.disabled = !page;
  controls.save.disabled = !page?.dirty;
}

function currentHunks() {
  if (!state.compareAnalysis) return [];
  return state.compareView === 'source'
    ? state.compareAnalysis.source?.hunks ?? []
    : state.compareAnalysis.visual?.hunks ?? [];
}

function activeHunk() {
  const hunks = currentHunks();
  if (hunks.length === 0) return null;
  const index = Math.min(Math.max(state.activeDifferenceIndex, 0), hunks.length - 1);
  return hunks[index] ?? null;
}

function sourceHunkRailRatio(hunk) {
  const rows = state.compareAnalysis?.source?.rows ?? [];
  if (rows.length <= 1) return 0.5;

  const indices = [];
  rows.forEach((row, index) => {
    if (row.hunkId === hunk.id) indices.push(index);
  });

  if (indices.length === 0) return 0.5;
  const middle = (indices[0] + indices.at(-1)) / 2;
  return Math.min(1, Math.max(0, middle / (rows.length - 1)));
}

function visualHunkRailRatio(hunk) {
  if (!state.compareFrameReady.left || !state.compareFrameReady.right) return null;

  const ratios = [];

  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    const doc = frame.contentDocument;
    const scroller = scrollingElement(frame);
    if (!doc || !scroller || scroller.scrollHeight <= 0) continue;

    const nodes = [...doc.querySelectorAll(`[data-hce-hunk="${hunk.id}"]`)];
    if (nodes.length === 0) continue;

    const tops = nodes.map((node) => node.getBoundingClientRect().top + scroller.scrollTop);
    const bottoms = nodes.map((node) => node.getBoundingClientRect().bottom + scroller.scrollTop);
    const center = (Math.min(...tops) + Math.max(...bottoms)) / 2;
    ratios.push(center / scroller.scrollHeight);
  }

  if (ratios.length === 0) return null;
  return Math.min(1, Math.max(0, ratios.reduce((sum, value) => sum + value, 0) / ratios.length));
}

function updateDifferenceRail() {
  const hunks = currentHunks();
  elements.differenceRail.replaceChildren();

  hunks.forEach((hunk, index) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.title = `Difference ${index + 1} of ${hunks.length}`;

    let ratio = state.compareView === 'source'
      ? sourceHunkRailRatio(hunk)
      : visualHunkRailRatio(hunk);

    if (!Number.isFinite(ratio)) {
      ratio = hunks.length === 1 ? 0.5 : index / Math.max(1, hunks.length - 1);
    }

    marker.style.top = `${Math.max(2, Math.min(98, ratio * 100))}%`;
    marker.classList.toggle('active', index === state.activeDifferenceIndex);
    marker.addEventListener('click', () => setActiveDifference(index, true));
    elements.differenceRail.append(marker);
  });
}

function updateCompareHistoryControls() {
  const history = state.compareHistory ?? {};
  const undoCount = history.undoCount ?? 0;
  const redoCount = history.redoCount ?? 0;

  elements.compareUndoButton.disabled = !history.canUndo;
  elements.compareRedoButton.disabled = !history.canRedo;
  elements.compareUndoButton.textContent = undoCount > 0 ? `Undo (${undoCount})` : 'Undo';
  elements.compareRedoButton.textContent = redoCount > 0 ? `Redo (${redoCount})` : 'Redo';
  elements.compareUndoButton.title = undoCount > 0
    ? `Undo merge, ${undoCount} step${undoCount === 1 ? '' : 's'} available (Ctrl+Z)`
    : 'Nothing to undo';
  elements.compareRedoButton.title = redoCount > 0
    ? `Redo merge, ${redoCount} step${redoCount === 1 ? '' : 's'} available (Ctrl+Y)`
    : 'Nothing to redo';
}

function updateDifferenceControls() {
  const hunks = currentHunks();
  const hasDifferences = hunks.length > 0;

  if (!hasDifferences) {
    state.activeDifferenceIndex = 0;
    elements.differenceCount.textContent = state.compare.left && state.compare.right
      ? 'No differences'
      : '0 differences';
  } else {
    state.activeDifferenceIndex = Math.min(state.activeDifferenceIndex, hunks.length - 1);
    elements.differenceCount.textContent = `${state.activeDifferenceIndex + 1} / ${hunks.length}`;
  }

  elements.previousDifferenceButton.disabled = !hasDifferences;
  elements.nextDifferenceButton.disabled = !hasDifferences;
  updateCompareHistoryControls();
  updateDifferenceRail();
}

function visualHunkCenterInGutter(hunk) {
  const gutterRect = elements.visualMergeGutter.getBoundingClientRect();
  const values = [];

  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    const doc = frame.contentDocument;
    if (!doc) continue;

    const nodes = [...doc.querySelectorAll(`[data-hce-hunk="${hunk.id}"]`)];
    if (nodes.length === 0) continue;

    const frameRect = frame.getBoundingClientRect();
    const tops = nodes.map((node) => frameRect.top + node.getBoundingClientRect().top);
    const bottoms = nodes.map((node) => frameRect.top + node.getBoundingClientRect().bottom);
    values.push(((Math.min(...tops) + Math.max(...bottoms)) / 2) - gutterRect.top);
  }

  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function renderVisualMergeGutter() {
  if (state.compareView !== 'visual') return;

  elements.visualMergeGutter.replaceChildren();
  const hunks = state.compareAnalysis?.visual?.hunks ?? [];
  const height = elements.visualMergeGutter.clientHeight;

  hunks.forEach((hunk, index) => {
    const y = visualHunkCenterInGutter(hunk);
    if (!Number.isFinite(y) || y < -24 || y > height + 24) return;

    const group = document.createElement('div');
    group.className = 'visual-merge-pair';
    group.style.top = `${Math.max(18, Math.min(height - 18, y))}px`;
    group.classList.toggle('active', index === state.activeDifferenceIndex);

    const toLeft = document.createElement('button');
    toLeft.type = 'button';
    toLeft.textContent = '←';
    toLeft.title = hunk.mergeableText
      ? `Copy difference ${index + 1} from right to left`
      : 'Structural difference: use Source view to merge';
    toLeft.disabled = !hunk.mergeableText;
    toLeft.addEventListener('click', (event) => {
      event.stopPropagation();
      setActiveDifference(index, false);
      void mergeDifference('right-to-left', hunk.id);
    });

    const toRight = document.createElement('button');
    toRight.type = 'button';
    toRight.textContent = '→';
    toRight.title = hunk.mergeableText
      ? `Copy difference ${index + 1} from left to right`
      : 'Structural difference: use Source view to merge';
    toRight.disabled = !hunk.mergeableText;
    toRight.addEventListener('click', (event) => {
      event.stopPropagation();
      setActiveDifference(index, false);
      void mergeDifference('left-to-right', hunk.id);
    });

    group.append(toLeft, toRight);
    elements.visualMergeGutter.append(group);
  });
}

function scheduleVisualMergeGutter() {
  if (scheduleVisualMergeGutter.pending) return;
  scheduleVisualMergeGutter.pending = true;
  window.requestAnimationFrame(() => {
    scheduleVisualMergeGutter.pending = false;
    renderVisualMergeGutter();
  });
}

function markActiveVisualHunk() {
  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    const doc = frame.contentDocument;
    if (!doc) continue;
    for (const node of doc.querySelectorAll('.hce-active-diff')) {
      node.classList.remove('hce-active-diff');
    }
  }

  const hunk = activeHunk();
  if (!hunk) return;

  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    const doc = frame.contentDocument;
    if (!doc) continue;
    for (const node of doc.querySelectorAll(`[data-hce-hunk="${hunk.id}"]`)) {
      node.classList.add('hce-active-diff');
    }
  }
}

function setActiveDifference(index, shouldScroll = false) {
  const hunks = currentHunks();
  if (hunks.length === 0) {
    state.activeDifferenceIndex = 0;
    updateDifferenceControls();
    return;
  }

  const normalized = ((index % hunks.length) + hunks.length) % hunks.length;
  state.activeDifferenceIndex = normalized;
  updateDifferenceControls();

  if (state.compareView === 'source') {
    for (const row of elements.sourceCompare.querySelectorAll('.active-hunk')) {
      row.classList.remove('active-hunk');
    }
    for (const pair of elements.sourceCompare.querySelectorAll('.source-merge-pair.active')) {
      pair.classList.remove('active');
    }
    const hunk = activeHunk();
    if (!hunk) return;
    const rows = [...elements.sourceCompare.querySelectorAll(`[data-hunk-id="${hunk.id}"]`)];
    rows.forEach((row) => row.classList.add('active-hunk'));
    const pair = rows.map((row) => row.querySelector('.source-merge-pair')).find(Boolean);
    pair?.classList.add('active');
    if (shouldScroll && rows[0]) rows[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  markActiveVisualHunk();
  scheduleVisualMergeGutter();
  if (!shouldScroll) return;

  const hunk = activeHunk();
  if (!hunk) return;

  state.programmaticUntil.left = performance.now() + 400;
  state.programmaticUntil.right = performance.now() + 400;

  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    const target = frame.contentDocument?.querySelector(`[data-hce-hunk="${hunk.id}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function navigateDifference(delta) {
  const hunks = currentHunks();
  if (hunks.length === 0) return;
  setActiveDifference(state.activeDifferenceIndex + delta, true);
}

function scrollingElement(frame) {
  return frame.contentDocument?.scrollingElement
    ?? frame.contentDocument?.documentElement
    ?? null;
}

function applyCompareZoom(frame) {
  const doc = frame.contentDocument;
  if (!doc?.documentElement) return;
  doc.documentElement.style.zoom = String(state.compareZoom);
}

function rebuildAlignmentPoints() {
  const leftScroller = scrollingElement(elements.compareLeftFrame);
  const rightScroller = scrollingElement(elements.compareRightFrame);
  const leftDoc = elements.compareLeftFrame.contentDocument;
  const rightDoc = elements.compareRightFrame.contentDocument;

  if (!leftScroller || !rightScroller || !leftDoc || !rightDoc) {
    state.alignmentPoints = [];
    return;
  }

  const points = [{
    left: 0,
    right: 0
  }];

  for (const anchor of state.compareAnalysis?.visual?.anchors ?? []) {
    const left = leftDoc.querySelector(`[data-hce-compare-id="${anchor.leftId}"]`);
    const right = rightDoc.querySelector(`[data-hce-compare-id="${anchor.rightId}"]`);
    if (!left || !right) continue;

    points.push({
      left: left.getBoundingClientRect().top + leftScroller.scrollTop,
      right: right.getBoundingClientRect().top + rightScroller.scrollTop
    });
  }

  points.push({
    left: leftScroller.scrollHeight,
    right: rightScroller.scrollHeight
  });

  points.sort((a, b) => a.left - b.left);

  const monotonic = [];
  let lastRight = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point.right + 1 < lastRight) continue;
    monotonic.push(point);
    lastRight = Math.max(lastRight, point.right);
  }

  state.alignmentPoints = monotonic;
}

function setScrollDriver(side) {
  state.scrollDriver = side;
  state.programmaticUntil[side] = 0;
  window.clearTimeout(state.scrollDriverTimer);
  state.scrollDriverTimer = window.setTimeout(() => {
    state.scrollDriver = null;
  }, 240);
}

function syncVisualScrollFrom(side) {
  if (!state.syncScroll) return;

  const targetSide = side === 'left' ? 'right' : 'left';
  const sourceFrame = side === 'left' ? elements.compareLeftFrame : elements.compareRightFrame;
  const targetFrame = targetSide === 'left' ? elements.compareLeftFrame : elements.compareRightFrame;
  const sourceScroller = scrollingElement(sourceFrame);
  const targetScroller = scrollingElement(targetFrame);
  if (!sourceScroller || !targetScroller) return;

  if (state.alignmentPoints.length < 2) {
    const ratio = scrollRatio(sourceScroller.scrollTop, sourceScroller.scrollHeight, sourceScroller.clientHeight);
    state.programmaticUntil[targetSide] = performance.now() + 140;
    targetScroller.scrollTop = scrollTopForRatio(ratio, targetScroller.scrollHeight, targetScroller.clientHeight);
    return;
  }

  const sourceKey = side;
  const targetKey = targetSide;
  const sourceCenter = sourceScroller.scrollTop + sourceScroller.clientHeight / 2;
  const targetCenter = mapAlignedPosition(
    state.alignmentPoints,
    sourceCenter,
    sourceKey,
    targetKey
  );

  const nextTop = Math.max(
    0,
    Math.min(
      targetScroller.scrollHeight - targetScroller.clientHeight,
      targetCenter - targetScroller.clientHeight / 2
    )
  );

  state.programmaticUntil[targetSide] = performance.now() + 140;
  targetScroller.scrollTop = nextTop;
}

function onVisualScroll(side) {
  scheduleVisualMergeGutter();
  if (performance.now() < state.programmaticUntil[side]) return;
  if (!state.scrollDriver) setScrollDriver(side);
  if (state.scrollDriver !== side) return;

  window.clearTimeout(state.scrollDriverTimer);
  state.scrollDriverTimer = window.setTimeout(() => {
    state.scrollDriver = null;
  }, 240);

  window.requestAnimationFrame(() => syncVisualScrollFrom(side));
  scheduleVisualMergeGutter();
}

function wireCompareFrame(side) {
  const { frame } = compareElementsFor(side);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return;

  state.compareFrameReady[side] = true;
  applyCompareZoom(frame);

  doc.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('a');
    if (anchor) event.preventDefault();

    const changed = event.target.closest?.('[data-hce-hunk]');
    if (changed) {
      const hunks = currentHunks();
      const index = hunks.findIndex((hunk) => hunk.id === changed.dataset.hceHunk);
      if (index >= 0) setActiveDifference(index, false);
    }
  }, true);

  for (const eventName of ['wheel', 'pointerdown', 'touchstart']) {
    doc.addEventListener(eventName, () => setScrollDriver(side), { passive: true });
  }

  win.addEventListener('scroll', () => onVisualScroll(side), { passive: true });

  if (state.compareFrameReady.left && state.compareFrameReady.right) {
    window.requestAnimationFrame(() => {
      rebuildAlignmentPoints();
      markActiveVisualHunk();
      renderVisualMergeGutter();
      updateDifferenceRail();

      if (state.pendingInitialDifferenceScroll && currentHunks().length > 0) {
        state.pendingInitialDifferenceScroll = false;
        setActiveDifference(state.activeDifferenceIndex, true);
      }
    });
  }
}

function renderCompareSide(side) {
  const { frame } = compareElementsFor(side);
  updateCompareHeader(side);
  state.compareFrameReady[side] = false;
  frame.onload = () => wireCompareFrame(side);
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.srcdoc = buildCompareDocument(side);
}

function appendInlineParts(container, parts, side) {
  if (!parts) return;

  for (const part of parts) {
    const span = document.createElement('span');
    span.textContent = part.text;
    if (part.changed) span.className = side === 'left' ? 'inline-left' : 'inline-right';
    container.append(span);
  }
}

function sourceCell(side, row) {
  const cell = document.createElement('div');
  cell.className = `source-cell ${side}`;

  const number = document.createElement('span');
  number.className = 'source-line-number';
  const lineNumber = side === 'left' ? row.leftLineNumber : row.rightLineNumber;
  number.textContent = lineNumber ?? '';

  const text = document.createElement('span');
  text.className = 'source-line-text';
  const rawText = side === 'left' ? row.leftText : row.rightText;
  const parts = side === 'left' ? row.leftParts : row.rightParts;

  if (lineNumber === null) text.classList.add('source-gap');

  if (row.hunkId && parts) {
    appendInlineParts(text, parts, side);
  } else {
    text.textContent = rawText;
  }

  cell.append(number, text);
  return cell;
}

function renderSourceCompare() {
  elements.sourceCompare.replaceChildren();

  const analysis = state.compareAnalysis?.source;
  if (!state.compare.left || !state.compare.right || !analysis) {
    const empty = document.createElement('div');
    empty.className = 'compare-empty';
    empty.textContent = 'Open a left and right HTML file to compare their source.';
    elements.sourceCompare.append(empty);
    return;
  }

  const hunkRowIndices = new Map();
  analysis.rows.forEach((row, rowIndex) => {
    if (!row.hunkId) return;
    const indices = hunkRowIndices.get(row.hunkId) ?? [];
    indices.push(rowIndex);
    hunkRowIndices.set(row.hunkId, indices);
  });

  const hunkMiddleRows = new Map(
    [...hunkRowIndices.entries()].map(([hunkId, indices]) => [
      hunkId,
      indices[Math.floor(indices.length / 2)]
    ])
  );

  const fragment = document.createDocumentFragment();

  analysis.rows.forEach((row, rowIndex) => {
    const line = document.createElement('div');
    line.className = `source-row ${row.hunkId ? `hunk-${row.kind}` : ''}`;

    let hunkIndex = -1;
    if (row.hunkId) {
      line.dataset.hunkId = row.hunkId;
      hunkIndex = analysis.hunks.findIndex((hunk) => hunk.id === row.hunkId);
      line.addEventListener('click', () => {
        if (hunkIndex >= 0) setActiveDifference(hunkIndex, false);
      });
    }

    const gutter = document.createElement('div');
    gutter.className = 'source-gutter';

    if (row.hunkId && hunkMiddleRows.get(row.hunkId) === rowIndex) {
      const pair = document.createElement('div');
      pair.className = 'source-merge-pair';
      pair.classList.toggle('active', hunkIndex === state.activeDifferenceIndex);

      const toLeft = document.createElement('button');
      toLeft.type = 'button';
      toLeft.textContent = '←';
      toLeft.title = `Copy difference ${hunkIndex + 1} from right to left`;
      toLeft.addEventListener('click', (event) => {
        event.stopPropagation();
        setActiveDifference(hunkIndex, false);
        void mergeDifference('right-to-left', row.hunkId);
      });

      const toRight = document.createElement('button');
      toRight.type = 'button';
      toRight.textContent = '→';
      toRight.title = `Copy difference ${hunkIndex + 1} from left to right`;
      toRight.addEventListener('click', (event) => {
        event.stopPropagation();
        setActiveDifference(hunkIndex, false);
        void mergeDifference('left-to-right', row.hunkId);
      });

      pair.append(toLeft, toRight);
      gutter.append(pair);
    }

    line.append(sourceCell('left', row), gutter, sourceCell('right', row));
    fragment.append(line);
  });

  elements.sourceCompare.append(fragment);
  setActiveDifference(state.activeDifferenceIndex, false);
}

function renderCompare() {
  updateCompareHeader('left');
  updateCompareHeader('right');

  const visual = state.compareView === 'visual';
  elements.visualCompare.classList.toggle('hidden', !visual);
  elements.sourceCompare.classList.toggle('hidden', visual);
  elements.syncScrollLabel.classList.toggle('hidden', !visual);
  elements.zoomControls.classList.toggle('hidden', !visual);

  for (const button of elements.compareViewButtons) {
    button.classList.toggle('active', button.dataset.compareView === state.compareView);
  }

  if (visual) {
    renderCompareSide('left');
    renderCompareSide('right');
  } else {
    renderSourceCompare();
  }

  updateDifferenceControls();
}

function setCompareView(view) {
  if (view !== 'visual' && view !== 'source') return;
  state.compareView = view;
  state.activeDifferenceIndex = 0;
  renderCompare();
}

function applyCompareResult(result, options = {}) {
  if (result?.state) {
    state.compare.left = result.state.left;
    state.compare.right = result.state.right;
  }

  if (result?.history) {
    state.compareHistory = result.history;
  }

  state.compareAnalysis = result?.analysis ?? null;
  const hunkCount = currentHunks().length;
  state.activeDifferenceIndex = Math.min(
    options.keepIndex ? state.activeDifferenceIndex : 0,
    Math.max(0, hunkCount - 1)
  );
  if (!options.keepIndex && hunkCount > 0) {
    state.pendingInitialDifferenceScroll = true;
  }
  renderCompare();
}

async function openCompare(side) {
  const result = await window.hce.openCompare(side);
  if (result.error) {
    showToast('Open failed: ' + result.error);
    return;
  }

  if (!result.cancelled) applyCompareResult(result);
}

async function reloadCompare(side) {
  const result = await window.hce.reloadCompare(side);
  if (result.error) {
    showToast('Reload failed: ' + result.error);
    return;
  }

  if (!result.missing && !result.cancelled) {
    applyCompareResult(result);
    showToast((side === 'left' ? 'Left' : 'Right') + ' page reloaded.');
  }
}

async function swapCompare() {
  const result = await window.hce.swapCompare();
  applyCompareResult(result);
}

async function saveCompare(side) {
  const result = await window.hce.saveCompare(side);
  if (!result.ok) {
    showToast('Save failed: ' + result.reason);
    return;
  }

  applyCompareResult(result, { keepIndex: true });
  if (result.backupPath) {
    showToast(`Saved ${side}. Backup created: ${result.backupPath}`);
  } else {
    showToast(`Saved ${side}.`);
  }
}

async function undoCompare() {
  const result = await window.hce.undoCompare();
  if (!result.ok) {
    showToast(result.reason);
    return;
  }

  applyCompareResult(result, { keepIndex: true });
  showToast('Merge undone.');
}

async function redoCompare() {
  const result = await window.hce.redoCompare();
  if (!result.ok) {
    showToast(result.reason);
    return;
  }

  applyCompareResult(result, { keepIndex: true });
  showToast('Merge redone.');
}

async function mergeDifference(direction, explicitHunkId = null) {
  const hunk = explicitHunkId
    ? currentHunks().find((candidate) => candidate.id === explicitHunkId)
    : activeHunk();

  if (!hunk) return;

  const result = await window.hce.mergeCompare(state.compareView, hunk.id, direction);
  if (!result.ok) {
    showToast(result.reason);
    return;
  }

  applyCompareResult(result, { keepIndex: true });
  showToast(direction === 'left-to-right'
    ? 'Copied selected difference to the right.'
    : 'Copied selected difference to the left.');
}

function setCompareZoom(nextZoom) {
  state.compareZoom = clampZoom(nextZoom);
  elements.zoomLabel.textContent = Math.round(state.compareZoom * 100) + '%';

  for (const frame of [elements.compareLeftFrame, elements.compareRightFrame]) {
    applyCompareZoom(frame);
  }

  window.requestAnimationFrame(() => {
    rebuildAlignmentPoints();
    renderVisualMergeGutter();
    updateDifferenceRail();
  });
}

function loadSession(session) {
  state.session = session;
  state.edits = {};
  state.workingSource = session.workingSource ?? session.source;
  state.undoStack = [];
  state.redoStack = [];
  state.searchMatches = [];
  state.searchIndex = -1;

  refreshWorkspaceVisibility();
  elements.fileName.textContent = session.fileName;
  elements.fileName.title = session.filePath;
  elements.editableCount.textContent = `${session.textNodes.length} editable text block${session.textNodes.length === 1 ? '' : 's'}`;
  elements.scriptWarning.classList.toggle('hidden', !session.hasScripts);
  elements.saveAsButton.disabled = false;
  elements.searchInput.disabled = false;
  elements.searchInput.value = '';
  elements.searchCount.textContent = '';

  setDirty(false);
  updateHistoryButtons();
  void setMode('edit');
}

async function openHtml() {
  if (state.session) await flushPendingEdits();
  const result = await window.hce.openHtml();
  if (result.error) {
    showToast(`Open failed: ${result.error}`);
    return;
  }

  if (!result.cancelled && result.session) loadSession(result.session);
}

async function save() {
  if (!state.session) return;
  await flushPendingEdits();
  if (!state.session.dirty) return;

  const result = await window.hce.save(state.workingSource);
  loadSession(result.session);

  if (result.backupPath) {
    showToast(`Saved. Backup created: ${result.backupPath}`);
  } else {
    showToast('Saved.');
  }
}

async function saveAs() {
  if (!state.session) return;
  await flushPendingEdits();

  const result = await window.hce.saveAs(state.workingSource);
  if (!result.cancelled && result.session) {
    loadSession(result.session);
    showToast('Saved as a new HTML file.');
  }
}

async function undo() {
  const action = state.undoStack.pop();
  if (!action) return;

  const node = nodeById(action.id);
  if (!node) return;

  state.redoStack.push(action);

  if (action.before === node.text) {
    delete state.edits[action.id];
  } else {
    state.edits[action.id] = action.before;
  }

  await rebuildWorkingSource();
  updateHistoryButtons();
  if (state.mode === 'edit') renderEdit();
  if (state.mode === 'preview') renderPreview();
  if (state.mode === 'diff') await renderDiff();
}

async function redo() {
  const action = state.redoStack.pop();
  if (!action) return;

  const node = nodeById(action.id);
  if (!node) return;

  state.undoStack.push(action);

  if (action.after === node.text) {
    delete state.edits[action.id];
  } else {
    state.edits[action.id] = action.after;
  }

  await rebuildWorkingSource();
  updateHistoryButtons();
  if (state.mode === 'edit') renderEdit();
  if (state.mode === 'preview') renderPreview();
  if (state.mode === 'diff') await renderDiff();
}

function runSearch(advance = false) {
  if (!state.session || state.mode !== 'edit') return;

  const doc = elements.pageFrame.contentDocument;
  if (!doc) return;

  const query = elements.searchInput.value.trim().toLocaleLowerCase();

  for (const element of doc.querySelectorAll('.hce-search-hit')) {
    element.classList.remove('hce-search-hit');
  }

  if (!query) {
    state.searchMatches = [];
    state.searchIndex = -1;
    elements.searchCount.textContent = '';
    elements.searchNextButton.disabled = true;
    return;
  }

  state.searchMatches = [...doc.querySelectorAll('[data-hce-id]')].filter((element) =>
    (element.textContent ?? '').toLocaleLowerCase().includes(query)
  );

  if (state.searchMatches.length === 0) {
    state.searchIndex = -1;
    elements.searchCount.textContent = '0 results';
    elements.searchNextButton.disabled = true;
    return;
  }

  if (advance) {
    state.searchIndex = (state.searchIndex + 1) % state.searchMatches.length;
  } else if (state.searchIndex < 0 || state.searchIndex >= state.searchMatches.length) {
    state.searchIndex = 0;
  }

  const current = state.searchMatches[state.searchIndex];
  current.classList.add('hce-search-hit');
  current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  elements.searchCount.textContent = `${state.searchIndex + 1}/${state.searchMatches.length}`;
  elements.searchNextButton.disabled = false;
}

for (const button of elements.workspaceModeButtons) {
  button.addEventListener('click', () => void setWorkspaceMode(button.dataset.workspaceMode));
}

for (const button of elements.compareViewButtons) {
  button.addEventListener('click', () => setCompareView(button.dataset.compareView));
}

elements.openCompareLeftButton.addEventListener('click', () => void openCompare('left'));
elements.openCompareRightButton.addEventListener('click', () => void openCompare('right'));
elements.reloadCompareLeftButton.addEventListener('click', () => void reloadCompare('left'));
elements.reloadCompareRightButton.addEventListener('click', () => void reloadCompare('right'));
elements.saveCompareLeftButton.addEventListener('click', () => void saveCompare('left'));
elements.saveCompareRightButton.addEventListener('click', () => void saveCompare('right'));
elements.swapCompareButton.addEventListener('click', () => void swapCompare());
elements.previousDifferenceButton.addEventListener('click', () => navigateDifference(-1));
elements.nextDifferenceButton.addEventListener('click', () => navigateDifference(1));
elements.compareUndoButton.addEventListener('click', () => void undoCompare());
elements.compareRedoButton.addEventListener('click', () => void redoCompare());
elements.syncScrollCheckbox.addEventListener('change', () => {
  state.syncScroll = elements.syncScrollCheckbox.checked;
});
elements.zoomOutButton.addEventListener('click', () => setCompareZoom(state.compareZoom - COMPARE_ZOOM_STEP));
elements.zoomResetButton.addEventListener('click', () => setCompareZoom(1));
elements.zoomInButton.addEventListener('click', () => setCompareZoom(state.compareZoom + COMPARE_ZOOM_STEP));

elements.openButton.addEventListener('click', openHtml);
elements.welcomeOpenButton.addEventListener('click', openHtml);
elements.saveButton.addEventListener('click', save);
elements.saveAsButton.addEventListener('click', saveAs);
elements.undoButton.addEventListener('click', undo);
elements.redoButton.addEventListener('click', redo);

for (const button of elements.modeButtons) {
  button.addEventListener('click', () => void setMode(button.dataset.mode));
}

elements.searchInput.addEventListener('input', () => runSearch(false));
elements.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runSearch(true);
});
elements.searchNextButton.addEventListener('click', () => runSearch(true));

document.addEventListener('keydown', (event) => {
  const modifier = event.ctrlKey || event.metaKey;

  if (state.workspaceMode === 'compare' && modifier && event.altKey && event.key === 'ArrowDown') {
    event.preventDefault();
    navigateDifference(1);
    return;
  }

  if (state.workspaceMode === 'compare' && modifier && event.altKey && event.key === 'ArrowUp') {
    event.preventDefault();
    navigateDifference(-1);
    return;
  }

  if (modifier && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    if (state.workspaceMode === 'compare') {
      void openCompare(state.compare.left ? 'right' : 'left');
    } else {
      void openHtml();
    }
    return;
  }

  if (state.workspaceMode === 'compare') {
    if (modifier && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undoCompare();
      return;
    }

    if (modifier && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      void redoCompare();
      return;
    }

    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      const dirty = ['left', 'right'].filter((side) => state.compare[side]?.dirty);
      if (dirty.length === 1) {
        void saveCompare(dirty[0]);
      } else if (dirty.length > 1) {
        showToast('Both sides have unsaved merges. Use the Save button on each side.');
      }
    }
    return;
  }

  if (modifier && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (event.shiftKey) {
      void saveAs();
    } else {
      void save();
    }
    return;
  }

  if (modifier && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    if (state.session && state.mode === 'edit') {
      elements.searchInput.focus();
      elements.searchInput.select();
    }
    return;
  }

  const active = elements.pageFrame.contentDocument?.activeElement;
  const editingText = active?.matches?.('[data-hce-id]');

  if (!editingText && modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    void undo();
  }

  if (!editingText && modifier && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
    event.preventDefault();
    void redo();
  }
});

renderCompareSide('left');
renderCompareSide('right');
setCompareZoom(1);
refreshWorkspaceVisibility();

Promise.all([
  window.hce.getSession(),
  window.hce.getCompareState()
]).then(([existing, compare]) => {
  if (existing) loadSession(existing);

  if (compare?.state && (compare.state.left || compare.state.right)) {
    state.workspaceMode = 'compare';
    refreshWorkspaceVisibility();
    applyCompareResult(compare);
  }
});

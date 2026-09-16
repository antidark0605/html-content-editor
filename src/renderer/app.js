const elements = {
  openButton: document.querySelector('#openButton'),
  welcomeOpenButton: document.querySelector('#welcomeOpenButton'),
  saveButton: document.querySelector('#saveButton'),
  saveAsButton: document.querySelector('#saveAsButton'),
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
  searchIndex: -1
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

function baseTag() {
  if (/<base\b/i.test(state.session.source)) return '';
  return `<base href="${escapeAttribute(state.session.baseHref)}">`;
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

  return injectIntoHead(
    parts.join(''),
    `${baseTag()}${editorStyle()}`
  );
}

function buildPreviewDocument() {
  return injectIntoHead(state.workingSource, baseTag());
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 3200);
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

    editable.addEventListener('blur', async () => {
      const id = editable.dataset.hceId;
      const before = editable.dataset.hceBefore ?? currentValueFor(id);
      const after = editable.textContent ?? before;

      if (after !== before) {
        await recordEdit(id, after, before);
      }
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

  const active = elements.pageFrame.contentDocument?.activeElement;
  if (active?.matches?.('[data-hce-id]')) {
    active.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  state.mode = mode;
  for (const button of elements.modeButtons) {
    button.classList.toggle('active', button.dataset.mode === mode);
  }

  if (mode === 'edit') renderEdit();
  if (mode === 'preview') renderPreview();
  if (mode === 'diff') await renderDiff();
}

function loadSession(session) {
  state.session = session;
  state.edits = {};
  state.workingSource = session.workingSource ?? session.source;
  state.undoStack = [];
  state.redoStack = [];
  state.searchMatches = [];
  state.searchIndex = -1;

  elements.welcome.classList.add('hidden');
  elements.workspace.classList.remove('hidden');
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
  const result = await window.hce.openHtml();
  if (result.error) {
    showToast(`Open failed: ${result.error}`);
    return;
  }

  if (!result.cancelled && result.session) {
    loadSession(result.session);
  }
}

async function save() {
  if (!state.session || !state.session.dirty) return;

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

  if (modifier && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    void openHtml();
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

window.hce.getSession().then((existing) => {
  if (existing) loadSession(existing);
});

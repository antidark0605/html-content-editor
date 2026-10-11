import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diffLines } from 'diff';
import {
  applyTextEdits,
  extractEditableTextNodes
} from './html-model.mjs';
import {
  buildCompareAnalysis,
  buildSourceComparison,
  mergeSourceHunk,
  mergeVisibleTextHunk
} from './compare-model.mjs';
import { firstUsableDirectory } from './open-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let session = null;
let compareSlots = { left: null, right: null };
let compareUndoStack = [];
let compareRedoStack = [];
let settings = {};
let allowClose = false;

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function loadSettings() {
  try {
    const raw = await fsp.readFile(settingsFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    settings = parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('Failed to read settings:', error);
    }
    settings = {};
  }
}

async function persistSettings() {
  try {
    await fsp.mkdir(app.getPath('userData'), { recursive: true });
    await fsp.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to save settings:', error);
  }
}

async function rememberOpenDirectory(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return;
  settings.lastOpenDirectory = path.dirname(filePath);
  await persistSettings();
}

function safeAppPath(name) {
  try {
    return app.getPath(name);
  } catch {
    return null;
  }
}

function directoryOf(filePath) {
  return typeof filePath === 'string' && filePath.length > 0
    ? path.dirname(filePath)
    : null;
}

async function resolveOpenDirectory(kind, side = null) {
  const candidates = kind === 'compare'
    ? [
        directoryOf(compareSlots[side === 'left' ? 'right' : 'left']?.filePath),
        directoryOf(compareSlots[side]?.filePath),
        settings.lastOpenDirectory,
        directoryOf(session?.filePath),
        safeAppPath('documents'),
        safeAppPath('home')
      ]
    : [
        directoryOf(session?.filePath),
        settings.lastOpenDirectory,
        safeAppPath('documents'),
        safeAppPath('home')
      ];

  return firstUsableDirectory(candidates, { timeoutMs: 1000 });
}

function openDialogOptions(title, defaultPath) {
  return {
    title,
    properties: ['openFile'],
    filters: [
      { name: 'HTML files', extensions: ['html', 'htm'] },
      { name: 'All files', extensions: ['*'] }
    ],
    ...(defaultPath ? { defaultPath } : {})
  };
}

function baseHrefFor(filePath) {
  return pathToFileURL(`${path.dirname(filePath)}${path.sep}`).href;
}

function sessionPayload() {
  if (!session) return null;

  return {
    filePath: session.filePath,
    fileName: path.basename(session.filePath),
    source: session.original,
    workingSource: session.working,
    textNodes: session.textNodes,
    baseHref: baseHrefFor(session.filePath),
    dirty: session.dirty,
    hasScripts: /<script\b/i.test(session.original)
  };
}

function makeSession(filePath, source) {
  session = {
    filePath,
    original: source,
    working: source,
    textNodes: extractEditableTextNodes(source),
    dirty: false
  };

  return sessionPayload();
}

async function readHtmlFile(filePath) {
  const source = await fsp.readFile(filePath, 'utf8');
  return makeSession(filePath, source);
}

function normalizeCompareSide(side) {
  if (side !== 'left' && side !== 'right') {
    throw new Error('Compare side must be left or right.');
  }
  return side;
}

function comparePayload(side) {
  const normalizedSide = normalizeCompareSide(side);
  const slot = compareSlots[normalizedSide];
  if (!slot) return null;

  return {
    side: normalizedSide,
    filePath: slot.filePath,
    fileName: path.basename(slot.filePath),
    source: slot.working,
    originalSource: slot.original,
    baseHref: baseHrefFor(slot.filePath),
    dirty: slot.dirty,
    hasScripts: /<script\b/i.test(slot.working)
  };
}

function compareStatePayload() {
  return {
    left: comparePayload('left'),
    right: comparePayload('right')
  };
}

function compareHistoryPayload() {
  return {
    canUndo: compareUndoStack.length > 0,
    canRedo: compareRedoStack.length > 0,
    undoCount: compareUndoStack.length,
    redoCount: compareRedoStack.length
  };
}

function resetCompareHistory() {
  compareUndoStack = [];
  compareRedoStack = [];
}

function compareSnapshot() {
  return {
    left: compareSlots.left?.working ?? null,
    right: compareSlots.right?.working ?? null
  };
}

function restoreCompareSnapshot(snapshot) {
  if (compareSlots.left && typeof snapshot?.left === 'string') {
    compareSlots.left.working = snapshot.left;
    compareSlots.left.dirty = compareSlots.left.working !== compareSlots.left.original;
  }

  if (compareSlots.right && typeof snapshot?.right === 'string') {
    compareSlots.right.working = snapshot.right;
    compareSlots.right.dirty = compareSlots.right.working !== compareSlots.right.original;
  }
}

function compareResultPayload() {
  return {
    state: compareStatePayload(),
    analysis: compareAnalysisPayload(),
    history: compareHistoryPayload()
  };
}

function compareAnalysisPayload() {
  const left = compareSlots.left?.working;
  const right = compareSlots.right?.working;
  if (typeof left !== 'string' || typeof right !== 'string') return null;
  return buildCompareAnalysis(left, right);
}

async function readCompareFile(side, filePath) {
  const normalizedSide = normalizeCompareSide(side);
  const source = await fsp.readFile(filePath, 'utf8');
  compareSlots[normalizedSide] = {
    filePath,
    original: source,
    working: source,
    dirty: false
  };
  resetCompareHistory();
  return comparePayload(normalizedSide);
}

function backupPathFor(filePath) {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}.hce-backup${parsed.ext || '.html'}`);
}

async function saveWithBackup(filePath, source, createBackup) {
  let backupPath = null;

  if (createBackup && fs.existsSync(filePath)) {
    backupPath = backupPathFor(filePath);

    if (!fs.existsSync(backupPath)) {
      await fsp.copyFile(filePath, backupPath);
    } else {
      backupPath = null;
    }
  }

  await fsp.writeFile(filePath, source, 'utf8');
  return backupPath;
}

function saveWithBackupSync(filePath, source) {
  if (fs.existsSync(filePath)) {
    const backupPath = backupPathFor(filePath);
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(filePath, backupPath);
    }
  }

  fs.writeFileSync(filePath, source, 'utf8');
}

function confirmEditorDiscardOrSave() {
  if (!session?.dirty) return true;

  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved changes',
    message: `Save changes to ${path.basename(session.filePath)}?`,
    detail: 'Your text edits have not been saved yet.'
  });

  if (choice === 2) return false;

  if (choice === 0) {
    try {
      saveWithBackupSync(session.filePath, session.working);
      makeSession(session.filePath, session.working);
    } catch (error) {
      dialog.showErrorBox('Save failed', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  return true;
}

function confirmCompareDiscardOrSave(side) {
  const normalizedSide = normalizeCompareSide(side);
  const slot = compareSlots[normalizedSide];
  if (!slot?.dirty) return true;

  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Unsaved comparison changes',
    message: `Save changes to ${path.basename(slot.filePath)}?`,
    detail: `The ${normalizedSide} comparison file has merged changes that are not saved.`
  });

  if (choice === 2) return false;

  if (choice === 0) {
    try {
      saveWithBackupSync(slot.filePath, slot.working);
      slot.original = slot.working;
      slot.dirty = false;
    } catch (error) {
      dialog.showErrorBox('Save failed', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  return true;
}

function confirmAllUnsaved() {
  if (!confirmEditorDiscardOrSave()) return false;
  if (!confirmCompareDiscardOrSave('left')) return false;
  if (!confirmCompareDiscardOrSave('right')) return false;
  return true;
}

function startupArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

async function loadStartupEditorFile() {
  const editorFile = startupArg('editor-file');
  if (editorFile && fs.existsSync(editorFile)) {
    await readHtmlFile(editorFile);
  }
}

async function loadStartupCompareFiles() {
  const left = startupArg('compare-left');
  const right = startupArg('compare-right');

  if (left && fs.existsSync(left)) await readCompareFile('left', left);
  if (right && fs.existsSync(right)) await readCompareFile('right', right);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 650,
    title: `HTML Content Editor v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (allowClose) return;

    if (!confirmAllUnsaved()) {
      event.preventDefault();
      return;
    }

    allowClose = true;
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('file:open', async () => {
  if (!confirmEditorDiscardOrSave()) return { cancelled: true };

  const defaultPath = await resolveOpenDirectory('editor');
  const result = await dialog.showOpenDialog(
    mainWindow,
    openDialogOptions('Open HTML file', defaultPath)
  );

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }

  try {
    const filePath = result.filePaths[0];
    const payload = await readHtmlFile(filePath);
    await rememberOpenDirectory(filePath);
    return { cancelled: false, session: payload };
  } catch (error) {
    return {
      cancelled: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle('compare:open', async (_event, requestedSide) => {
  const side = normalizeCompareSide(requestedSide);
  if (!confirmCompareDiscardOrSave(side)) return { cancelled: true };

  const defaultPath = await resolveOpenDirectory('compare', side);
  const result = await dialog.showOpenDialog(
    mainWindow,
    openDialogOptions(
      side === 'left' ? 'Open left HTML file' : 'Open right HTML file',
      defaultPath
    )
  );

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }

  try {
    const filePath = result.filePaths[0];
    const page = await readCompareFile(side, filePath);
    await rememberOpenDirectory(filePath);
    return {
      cancelled: false,
      page,
      ...compareResultPayload()
    };
  } catch (error) {
    return {
      cancelled: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle('compare:reload', async (_event, requestedSide) => {
  const side = normalizeCompareSide(requestedSide);
  const slot = compareSlots[side];
  if (!slot) return { missing: true };
  if (!confirmCompareDiscardOrSave(side)) return { cancelled: true };

  try {
    await readCompareFile(side, slot.filePath);
    return {
      missing: false,
      cancelled: false,
      page: comparePayload(side),
      ...compareResultPayload()
    };
  } catch (error) {
    return {
      missing: false,
      cancelled: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle('compare:swap', async () => {
  [compareSlots.left, compareSlots.right] = [compareSlots.right, compareSlots.left];
  resetCompareHistory();
  return compareResultPayload();
});

ipcMain.handle('compare:get-state', async () => compareResultPayload());

ipcMain.handle('compare:analyze', async () => compareAnalysisPayload());

ipcMain.handle('compare:edit-text', async (_event, requestedSide, nodeId, value) => {
  const side = normalizeCompareSide(requestedSide);
  const slot = compareSlots[side];

  if (!slot) {
    return { ok: false, reason: 'No comparison file is open on this side.' };
  }

  if (typeof nodeId !== 'string' || typeof value !== 'string') {
    return { ok: false, reason: 'Invalid compare text edit.' };
  }

  const textNodes = extractEditableTextNodes(slot.working);
  const node = textNodes.find((candidate) => candidate.id === nodeId);

  if (!node) {
    return { ok: false, reason: 'The edited text block no longer exists. Reload the comparison.' };
  }

  if (node.text === value) {
    return { ok: true, ...compareResultPayload() };
  }

  compareUndoStack.push(compareSnapshot());
  compareRedoStack = [];

  slot.working = applyTextEdits(slot.working, textNodes, { [nodeId]: value });
  slot.dirty = slot.working !== slot.original;

  return {
    ok: true,
    ...compareResultPayload()
  };
});

ipcMain.handle('compare:merge', async (_event, mode, hunkId, direction) => {
  if (!compareSlots.left || !compareSlots.right) {
    return { ok: false, reason: 'Open both comparison files first.' };
  }

  const leftSource = compareSlots.left.working;
  const rightSource = compareSlots.right.working;
  const result = mode === 'source'
    ? mergeSourceHunk(leftSource, rightSource, hunkId, direction)
    : mergeVisibleTextHunk(leftSource, rightSource, hunkId, direction);

  if (!result.ok) return result;

  compareUndoStack.push(compareSnapshot());
  compareRedoStack = [];

  compareSlots.left.working = result.leftSource;
  compareSlots.right.working = result.rightSource;
  compareSlots.left.dirty = compareSlots.left.working !== compareSlots.left.original;
  compareSlots.right.dirty = compareSlots.right.working !== compareSlots.right.original;

  return {
    ok: true,
    ...compareResultPayload()
  };
});

ipcMain.handle('compare:undo', async () => {
  if (compareUndoStack.length === 0) {
    return { ok: false, reason: 'Nothing to undo.', ...compareResultPayload() };
  }

  compareRedoStack.push(compareSnapshot());
  const snapshot = compareUndoStack.pop();
  restoreCompareSnapshot(snapshot);

  return {
    ok: true,
    ...compareResultPayload()
  };
});

ipcMain.handle('compare:redo', async () => {
  if (compareRedoStack.length === 0) {
    return { ok: false, reason: 'Nothing to redo.', ...compareResultPayload() };
  }

  compareUndoStack.push(compareSnapshot());
  const snapshot = compareRedoStack.pop();
  restoreCompareSnapshot(snapshot);

  return {
    ok: true,
    ...compareResultPayload()
  };
});

ipcMain.handle('compare:save', async (_event, requestedSide) => {
  const side = normalizeCompareSide(requestedSide);
  const slot = compareSlots[side];
  if (!slot) return { ok: false, reason: 'No comparison file is open on this side.' };
  if (!slot.dirty) return { ok: true, page: comparePayload(side), backupPath: null };

  try {
    const backupPath = await saveWithBackup(slot.filePath, slot.working, true);
    slot.original = slot.working;
    slot.dirty = false;
    return {
      ok: true,
      page: comparePayload(side),
      backupPath,
      ...compareResultPayload()
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle('html:apply-edits', async (_event, edits) => {
  if (!session) throw new Error('No HTML file is open.');

  const working = applyTextEdits(session.original, session.textNodes, edits ?? {});
  session.working = working;
  session.dirty = working !== session.original;

  return {
    workingSource: working,
    dirty: session.dirty
  };
});

ipcMain.handle('file:save', async (_event, workingSource) => {
  if (!session) throw new Error('No HTML file is open.');
  if (typeof workingSource !== 'string') throw new Error('Invalid HTML content.');

  const filePath = session.filePath;
  const backupPath = await saveWithBackup(filePath, workingSource, true);
  const payload = makeSession(filePath, workingSource);

  return { session: payload, backupPath };
});

ipcMain.handle('file:save-as', async (_event, workingSource) => {
  if (!session) throw new Error('No HTML file is open.');
  if (typeof workingSource !== 'string') throw new Error('Invalid HTML content.');

  const parsed = path.parse(session.filePath);
  const saveDirectory = await firstUsableDirectory(
    [
      parsed.dir,
      settings.lastOpenDirectory,
      safeAppPath('documents'),
      safeAppPath('home')
    ],
    { timeoutMs: 1000 }
  );
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save HTML As',
    defaultPath: saveDirectory
      ? path.join(saveDirectory, parsed.name + parsed.ext)
      : parsed.name + parsed.ext,
    filters: [
      { name: 'HTML files', extensions: ['html', 'htm'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { cancelled: true };
  }

  await fsp.writeFile(result.filePath, workingSource, 'utf8');
  await rememberOpenDirectory(result.filePath);
  return {
    cancelled: false,
    session: makeSession(result.filePath, workingSource)
  };
});

ipcMain.handle('html:diff', async (_event, workingSource) => {
  if (!session) return [];

  return diffLines(session.original, workingSource ?? session.working).map((part) => ({
    value: part.value,
    added: Boolean(part.added),
    removed: Boolean(part.removed),
    count: part.count ?? 0
  }));
});

ipcMain.handle('html:diff-analysis', async (_event, workingSource) => {
  if (!session) return null;
  return buildSourceComparison(session.original, workingSource ?? session.working);
});

ipcMain.handle('app:get-session', async () => sessionPayload());
ipcMain.handle('app:get-version', async () => app.getVersion());

app.whenReady().then(async () => {
  await loadSettings();
  await loadStartupEditorFile();
  await loadStartupCompareFiles();
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      allowClose = false;
      await createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (mainWindow && !allowClose && !confirmAllUnsaved()) {
    return;
  }
  allowClose = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

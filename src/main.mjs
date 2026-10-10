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
  mergeSourceHunk,
  mergeVisibleTextHunk
} from './compare-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let session = null;
let compareSlots = { left: null, right: null };
let allowClose = false;

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
    title: 'HTML Content Editor',
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

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open HTML file',
    properties: ['openFile'],
    filters: [
      { name: 'HTML files', extensions: ['html', 'htm'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }

  try {
    return { cancelled: false, session: await readHtmlFile(result.filePaths[0]) };
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

  const result = await dialog.showOpenDialog(mainWindow, {
    title: side === 'left' ? 'Open left HTML file' : 'Open right HTML file',
    properties: ['openFile'],
    filters: [
      { name: 'HTML files', extensions: ['html', 'htm'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }

  try {
    return {
      cancelled: false,
      page: await readCompareFile(side, result.filePaths[0]),
      state: compareStatePayload(),
      analysis: compareAnalysisPayload()
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
      state: compareStatePayload(),
      analysis: compareAnalysisPayload()
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
  return {
    state: compareStatePayload(),
    analysis: compareAnalysisPayload()
  };
});

ipcMain.handle('compare:get-state', async () => ({
  state: compareStatePayload(),
  analysis: compareAnalysisPayload()
}));

ipcMain.handle('compare:analyze', async () => compareAnalysisPayload());

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

  compareSlots.left.working = result.leftSource;
  compareSlots.right.working = result.rightSource;
  compareSlots.left.dirty = compareSlots.left.working !== compareSlots.left.original;
  compareSlots.right.dirty = compareSlots.right.working !== compareSlots.right.original;

  return {
    ok: true,
    state: compareStatePayload(),
    analysis: compareAnalysisPayload()
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
      state: compareStatePayload(),
      analysis: compareAnalysisPayload()
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
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save HTML As',
    defaultPath: path.join(parsed.dir, parsed.name + parsed.ext),
    filters: [
      { name: 'HTML files', extensions: ['html', 'htm'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { cancelled: true };
  }

  await fsp.writeFile(result.filePath, workingSource, 'utf8');
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

ipcMain.handle('app:get-session', async () => sessionPayload());

app.whenReady().then(async () => {
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

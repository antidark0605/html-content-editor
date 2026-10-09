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
    source: slot.source,
    baseHref: baseHrefFor(slot.filePath),
    hasScripts: /<script\b/i.test(slot.source)
  };
}

async function readCompareFile(side, filePath) {
  const normalizedSide = normalizeCompareSide(side);
  const source = await fsp.readFile(filePath, 'utf8');
  compareSlots[normalizedSide] = { filePath, source };
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

function confirmDiscardOrSave() {
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 620,
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

    if (!confirmDiscardOrSave()) {
      event.preventDefault();
      return;
    }

    allowClose = true;
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

ipcMain.handle('file:open', async () => {
  if (!confirmDiscardOrSave()) return { cancelled: true };

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
      page: await readCompareFile(side, result.filePaths[0])
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

  try {
    return {
      missing: false,
      page: await readCompareFile(side, slot.filePath)
    };
  } catch (error) {
    return {
      missing: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
});

ipcMain.handle('compare:swap', async () => {
  [compareSlots.left, compareSlots.right] = [compareSlots.right, compareSlots.left];
  return {
    left: comparePayload('left'),
    right: comparePayload('right')
  };
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
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      allowClose = false;
      await createWindow();
    }
  });
});

app.on('before-quit', () => {
  if (mainWindow && !allowClose && !confirmDiscardOrSave()) {
    return;
  }
  allowClose = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

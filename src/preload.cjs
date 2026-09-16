const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hce', {
  openHtml: () => ipcRenderer.invoke('file:open'),
  applyEdits: (edits) => ipcRenderer.invoke('html:apply-edits', edits),
  save: (workingSource) => ipcRenderer.invoke('file:save', workingSource),
  saveAs: (workingSource) => ipcRenderer.invoke('file:save-as', workingSource),
  diff: (workingSource) => ipcRenderer.invoke('html:diff', workingSource),
  getSession: () => ipcRenderer.invoke('app:get-session')
});

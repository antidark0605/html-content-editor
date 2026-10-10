const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hce', {
  openHtml: () => ipcRenderer.invoke('file:open'),
  openCompare: (side) => ipcRenderer.invoke('compare:open', side),
  reloadCompare: (side) => ipcRenderer.invoke('compare:reload', side),
  swapCompare: () => ipcRenderer.invoke('compare:swap'),
  getCompareState: () => ipcRenderer.invoke('compare:get-state'),
  analyzeCompare: () => ipcRenderer.invoke('compare:analyze'),
  mergeCompare: (mode, hunkId, direction) => ipcRenderer.invoke('compare:merge', mode, hunkId, direction),
  saveCompare: (side) => ipcRenderer.invoke('compare:save', side),
  applyEdits: (edits) => ipcRenderer.invoke('html:apply-edits', edits),
  save: (workingSource) => ipcRenderer.invoke('file:save', workingSource),
  saveAs: (workingSource) => ipcRenderer.invoke('file:save-as', workingSource),
  diff: (workingSource) => ipcRenderer.invoke('html:diff', workingSource),
  getSession: () => ipcRenderer.invoke('app:get-session')
});

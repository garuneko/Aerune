const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveSession: (sessionData) => ipcRenderer.invoke('save-session', sessionData),
    loadSession: () => ipcRenderer.invoke('load-session')
});
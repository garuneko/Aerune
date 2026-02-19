const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let sessionPath;
let mainWindow;

function createWindow() {
  sessionPath = path.join(app.getPath('userData'), 'session.json');
  mainWindow = new BrowserWindow({
    width: 1000, height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

ipcMain.handle('save-session', (event, sessionData) => {
  try {
    const dataStr = JSON.stringify(sessionData);
    const dataToSave = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(dataStr) : dataStr;
    fs.writeFileSync(sessionPath, dataToSave);
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('load-session', () => {
  if (!fs.existsSync(sessionPath)) return null;
  try {
    const fileData = fs.readFileSync(sessionPath);
    if (safeStorage.isEncryptionAvailable()) {
      try { return JSON.parse(safeStorage.decryptString(fileData)); }
      catch (e) { fs.unlinkSync(sessionPath); return null; }
    }
    return JSON.parse(fileData.toString());
  } catch (e) { return null; }
});
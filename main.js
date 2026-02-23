const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

let sessionPath;
let mainWindow;
let boundsPath;

function createWindow() {
  sessionPath = path.join(app.getPath('userData'), 'session.json');
  boundsPath = path.join(app.getPath('userData'), 'bounds.json');

  // 前回終了時のウィンドウサイズを読み込む
  let bounds = { width: 1000, height: 800 };
  try { if (fs.existsSync(boundsPath)) bounds = JSON.parse(fs.readFileSync(boundsPath)); } catch(e) {}

  mainWindow = new BrowserWindow({
    ...bounds, // 読み込んだサイズ・座標を適用
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  mainWindow.loadFile('index.html');

  // アプリ終了時にサイズと座標を保存
  mainWindow.on('close', () => {
    try { fs.writeFileSync(boundsPath, JSON.stringify(mainWindow.getBounds())); } catch(e) {}
  });
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
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));
}

let mainWindow;
let serverHandle;
let serverStarting;

async function startEmbeddedServer() {
  if (serverHandle) return serverHandle;
  if (serverStarting) return serverStarting;
  const { startServer } = require('../server/index');
  const dbPath = path.join(app.getPath('userData'), 'neuralab.db');
  serverStarting = startServer({ dbPath, port: 4317 })
    .then((handle) => {
      serverHandle = handle;
      serverStarting = null;
      return handle;
    })
    .catch((err) => {
      serverStarting = null;
      throw err;
    });
  return serverStarting;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  const cfg = loadConfig();
  if (!cfg) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'));
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
}

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:setupHost', async () => {
  const handle = await startEmbeddedServer();
  const cfg = { mode: 'host', serverUrl: `http://${handle.ip}:${handle.port}` };
  saveConfig(cfg);
  return cfg;
});

ipcMain.handle('config:setupClient', async (event, serverUrl) => {
  try {
    const url = serverUrl.replace(/\/$/, '');
    const res = await fetch(`${url}/health`);
    if (!res.ok) throw new Error('Сервер недоступен');
    const cfg = { mode: 'client', serverUrl: url };
    saveConfig(cfg);
    return { ok: true, cfg };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('app:reload', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
});

ipcMain.handle('app:reset', () => {
  try { fs.unlinkSync(configPath); } catch {}
  app.relaunch();
  app.exit(0);
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const cfg = loadConfig();
    if (cfg && cfg.mode === 'host') {
      try {
        await startEmbeddedServer();
      } catch (err) {
        dialog.showErrorBox('Ошибка запуска сервера', String(err));
      }
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

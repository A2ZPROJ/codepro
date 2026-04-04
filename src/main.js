const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const isDev = process.argv.includes('--dev');

// Log de atualização para diagnóstico
const UPDATE_LOG = path.join(os.homedir(), 'codepro-update.log');
function logUpdate(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(UPDATE_LOG, line);
  } catch(e) {}
}

autoUpdater.autoDownload = false;          // download controlado manualmente
autoUpdater.autoInstallOnAppQuit = true;   // fallback: instala se o app fechar com update pendente

let splashWindow, mainWindow, sessionUser = null;

// Estado do update preservado entre janelas
let updateState = { status: 'idle', version: null }; // idle | available | downloading | downloaded

function createSplash(){
  splashWindow = new BrowserWindow({
    width: 480,
    height: 720,
    resizable: false,
    frame: false,
    center: true,
    icon: path.join(__dirname,'../assets/icon.ico'),
    webPreferences:{
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#060d1b',
    show: false,
  });
  splashWindow.loadFile(path.join(__dirname,'splash.html'));
  splashWindow.once('ready-to-show', ()=>{
    splashWindow.show();
    if(!isDev) setTimeout(()=> checkForUpdates(), 2500);
  });
}

function createMain(licenseData){
  const licArg = licenseData
    ? `--codepro-lic=${Buffer.from(JSON.stringify(licenseData)).toString('base64')}`
    : '--codepro-lic=';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Nexus',
    icon: path.join(__dirname,'../assets/icon.ico'),
    webPreferences:{
      preload: path.join(__dirname,'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      additionalArguments: [licArg],
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  const licQuery = licenseData ? Buffer.from(JSON.stringify(licenseData)).toString('base64') : '';
  mainWindow.loadFile(path.join(__dirname,'app','index.html'), { query: licQuery ? { lic: licQuery } : {} });

  mainWindow.once('ready-to-show', ()=>{
    if(splashWindow){ splashWindow.close(); splashWindow=null; }
    mainWindow.show();
    // Sempre verifica ao abrir — se já havia um update pendente, renderer consulta via get-update-state
    if(!isDev) checkForUpdates();
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    shell.openExternal(url);
    return {action:'deny'};
  });

  mainWindow.on('closed',()=>{ mainWindow=null; });
}

ipcMain.on('splash-done', (event, licenseData)=>{
  sessionUser = licenseData;
  createMain(licenseData);
});

ipcMain.on('get-session-sync', (event)=>{
  event.returnValue = sessionUser || null;
});

// Renderer pode consultar estado atual do update (resolve race condition)
ipcMain.on('get-update-state', (event)=>{
  event.returnValue = updateState;
});

app.whenReady().then(()=>{
  createSplash();
  app.on('activate',()=>{
    if(!mainWindow && !splashWindow) createSplash();
  });
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});

// ── AUTO-UPDATER ──
function checkForUpdates(){
  logUpdate('checkForUpdates called');
  autoUpdater.checkForUpdates().catch(err => logUpdate('checkForUpdates error: ' + err));
}

autoUpdater.on('checking-for-update', ()=> logUpdate('checking-for-update'));

autoUpdater.on('update-not-available', ()=>{
  logUpdate('update-not-available');
  updateState = { status: 'up-to-date', version: null };
  splashWindow?.webContents.send('update-not-available');
  mainWindow?.webContents.send('update-not-available');
});

autoUpdater.on('update-available', info=>{
  logUpdate('update-available: ' + info.version);
  updateState = { status: 'available', version: info.version };
  splashWindow?.webContents.send('update-available', info.version);
  mainWindow?.webContents.send('update-available', info.version);
  // Inicia download automaticamente em background
  autoUpdater.downloadUpdate().catch(err => logUpdate('downloadUpdate error: ' + err));
});

autoUpdater.on('download-progress', progress=>{
  updateState.status = 'downloading';
  splashWindow?.webContents.send('update-progress', Math.round(progress.percent));
  mainWindow?.webContents.send('update-progress', Math.round(progress.percent));
});

autoUpdater.on('update-downloaded', info=>{
  logUpdate('update-downloaded: ' + info.version);
  updateState = { status: 'downloaded', version: info.version };
  splashWindow?.webContents.send('update-downloaded', info.version);
  mainWindow?.webContents.send('update-downloaded', info.version);
});

autoUpdater.on('error', (err)=>{ logUpdate('autoUpdater error: ' + err); });

ipcMain.on('install-update', ()=> autoUpdater.quitAndInstall(true, true)); // silencioso + reabre

// ── CONFERÊNCIA DE ARQUIVOS ──
ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('read-dir', async (event, folderPath) => {
  try {
    return fs.readdirSync(folderPath, { withFileTypes: true })
             .filter(e => e.isFile())
             .map(e => e.name);
  } catch { return []; }
});

ipcMain.handle('rename-files', async (event, { folder, items }) => {
  const results = [];
  for (const item of items) {
    try {
      fs.renameSync(path.join(folder, item.from), path.join(folder, item.to));
      results.push({ from: item.from, ok: true });
    } catch(e) {
      results.push({ from: item.from, ok: false, error: e.message });
    }
  }
  return results;
});

ipcMain.on('sign-out', ()=>{
  sessionUser = null;
  updateState = { status: 'idle', version: null };
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  createSplash();
});

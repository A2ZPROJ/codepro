const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const isDev = process.argv.includes('--dev');

let splashWindow, mainWindow, sessionUser = null;

function createSplash(){
  splashWindow = new BrowserWindow({
    width: 420,
    height: 620,
    resizable: false,
    frame: false,
    center: true,
    icon: path.join(__dirname,'../assets/icon.ico'),
    webPreferences:{
      nodeIntegration: true,
      contextIsolation: false,
    },
    backgroundColor: '#0a0f1e',
    show: false,
  });
  splashWindow.loadFile(path.join(__dirname,'splash.html'));
  splashWindow.once('ready-to-show', ()=> splashWindow.show());
}

function createMain(licenseData){
  // Passa a licença diretamente como argumento do processo — método mais confiável
  const licArg = licenseData
    ? `--codepro-lic=${Buffer.from(JSON.stringify(licenseData)).toString('base64')}`
    : '--codepro-lic=';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'CodePro',
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

  mainWindow.loadFile(path.join(__dirname,'app','index.html'));

  mainWindow.once('ready-to-show', ()=>{
    if(splashWindow){ splashWindow.close(); splashWindow=null; }
    mainWindow.show();
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

app.whenReady().then(()=>{
  createSplash();
  app.on('activate',()=>{
    if(!mainWindow && !splashWindow) createSplash();
  });
});

app.on('window-all-closed',()=>{
  if(process.platform!=='darwin') app.quit();
});

function checkForUpdates(){
  autoUpdater.checkForUpdatesAndNotify();
}
autoUpdater.on('update-available', info=>{
  mainWindow?.webContents.send('update-available', info.version);
});
autoUpdater.on('update-downloaded', info=>{
  mainWindow?.webContents.send('update-downloaded', info.version);
});
ipcMain.on('install-update', ()=> autoUpdater.quitAndInstall());

ipcMain.on('sign-out', ()=>{
  sessionUser = null;
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  createSplash();
});

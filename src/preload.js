const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 1) Tenta buscar a sessão do processo principal via IPC síncrono
let licenseData = null;
try {
  licenseData = ipcRenderer.sendSync('get-session-sync');
} catch(e) {}

// 2) Fallback: lê diretamente do arquivo de store se o IPC não retornou nada
//    Preloads sempre têm acesso ao Node.js, mesmo com nodeIntegration: false
if (!licenseData || !licenseData.id) {
  try {
    const storePath = path.join(os.homedir(), '.codepro', 'config.json');
    const raw = fs.readFileSync(storePath, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.license && data.license.id) {
      licenseData = data.license;
    }
  } catch(e) {}
}

contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_,v) => cb(v)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_,v) => cb(v)),
  installUpdate: () => ipcRenderer.send('install-update'),
  getLicense: () => licenseData,
  signOut: () => ipcRenderer.send('sign-out'),
});

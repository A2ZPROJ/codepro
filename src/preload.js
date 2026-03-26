const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let licenseData = null;

// 1) Principal: additionalArguments passado pelo main na criação da janela
try {
  const arg = process.argv.find(a => a.startsWith('--codepro-lic='));
  if (arg) {
    const b64 = arg.slice('--codepro-lic='.length);
    if (b64) licenseData = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }
} catch(e) {}

// 2) Fallback: IPC síncrono
if (!licenseData || !licenseData.id) {
  try { licenseData = ipcRenderer.sendSync('get-session-sync'); } catch(e) {}
}

// 3) Fallback: leitura direta do store em disco
if (!licenseData || !licenseData.id) {
  try {
    const storePath = path.join(os.homedir(), '.codepro', 'config.json');
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (data?.license?.id) licenseData = data.license;
  } catch(e) {}
}

contextBridge.exposeInMainWorld('electronAPI', {
  getLicense:        () => licenseData,
  signOut:           () => ipcRenderer.send('sign-out'),
  downloadUpdate:    () => ipcRenderer.send('download-update'),
  installUpdate:     () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, v)   => cb(v)),
  onUpdateProgress:  (cb) => ipcRenderer.on('update-progress',  (_, pct) => cb(pct)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded', (_, v)   => cb(v)),
});

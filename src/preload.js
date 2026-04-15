const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { classifyOse, crossCheckPVs } = require('./oseStatus');
const { deepCheck: deepCheckOse } = require('./oseDeepCheck');
const { generateMemorial } = require('./memorialGenerator');
const { generateFromTemplate } = require('./memorialTemplate');

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

// Com contextIsolation: false, podemos expor diretamente no window do renderer
window.electronAPI = {
  getLicense:        () => licenseData,
  getUpdateState:    () => ipcRenderer.sendSync('get-update-state'),
  signOut:           () => ipcRenderer.send('sign-out'),
  installUpdate:     () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, v)   => cb(v)),
  onUpdateProgress:  (cb) => ipcRenderer.on('update-progress',  (_, pct) => cb(pct)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded', (_, v)   => cb(v)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', () => cb()),
  selectFolder: ()           => ipcRenderer.invoke('select-folder'),
  readDir:      (p)          => ipcRenderer.invoke('read-dir', p),
  renameFiles:  (opts)       => ipcRenderer.invoke('rename-files', opts),
  selectFile:   (filters)    => ipcRenderer.invoke('select-file', filters),
  parseOse:       (opts)       => ipcRenderer.invoke('parse-ose', opts),
  exportOseXlsx:  (opts)       => ipcRenderer.invoke('export-ose-xlsx', opts),
  classifyOse:    (r)          => classifyOse(r),
  crossCheckPVs:  (data)       => crossCheckPVs(data),
  deepCheckOse:   (data)       => deepCheckOse(data),
  generateMemorial: (info, agg) => generateMemorial(info, agg),
  generateFromTemplate: (tplPath, info, agg) => generateFromTemplate(tplPath, info, agg),
  dashboard: {
    getData:        ()    => ipcRenderer.invoke('dashboard:get-data'),
    getHistory:     ()    => ipcRenderer.invoke('dashboard:get-history'),
    pickFile:       ()    => ipcRenderer.invoke('dashboard:pick-file'),
    getPublicLink:  ()    => ipcRenderer.invoke('dashboard:get-public-link'),
    onDataUpdated:  (cb)  => ipcRenderer.on('dashboard:data-updated', (_, data) => cb(data)),
  },
};

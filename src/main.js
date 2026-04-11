const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const isDev = process.argv.includes('--dev');

// ── Supabase client (dashboard público) ──
const SUPA_URL = 'https://xszpzsmdpbgaiodeqcpi.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenB6c21kcGJnYWlvZGVxY3BpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTI5ODYsImV4cCI6MjA4OTg4ODk4Nn0.Wv_tcovD5nc13tmrfkgsVb6M6tS-CC7q6HVjphpzTrQ';
const supabase = createClient(SUPA_URL, SUPA_ANON, { auth: { persistSession: false } });

async function pushDashboardToSupabase(parsedData) {
  try {
    const { error } = await supabase
      .from('dashboard_data')
      .upsert({ id: 1, data: parsedData, updated_at: parsedData.updatedAt }, { onConflict: 'id' });
    if (error) {
      logUpdate('dashboard supabase push error: ' + error.message);
    } else {
      logUpdate('dashboard supabase push ok: ' + (parsedData.municipalities?.length || 0) + ' municípios');
    }
  } catch (e) {
    logUpdate('dashboard supabase push exception: ' + e.message);
  }
  // Push paralelo de snapshot diário em dashboard_history (silencia falha se tabela não existir)
  pushDashboardHistory(parsedData).catch(()=>{});
}

// Snapshot diário p/ Curva S — upsert por snap_date, último valor do dia prevalece
async function pushDashboardHistory(parsedData) {
  try {
    const muns = parsedData.municipalities || [];
    if (!muns.length) return;
    const SVC_KEYS = ['topo','stream','sondT','sondS','projB','projR','projE'];
    let sumPct = 0, cnt = 0;
    const svcAcc = {}; SVC_KEYS.forEach(k => svcAcc[k] = { s:0, n:0 });
    const byMun = [];
    muns.forEach(m => {
      let mSum = 0, mN = 0;
      SVC_KEYS.forEach(k => {
        const sv = m.svc?.[k]; if (!sv) return;
        const p = (sv.pct != null) ? sv.pct : (sv.st === 'Finalizado' ? 100 : (sv.st === 'Em Execução' ? 50 : 0));
        sumPct += p; cnt++;
        svcAcc[k].s += p; svcAcc[k].n++;
        mSum += p; mN++;
      });
      byMun.push({ mun: m.mun, pct: mN ? Math.round(mSum/mN) : 0 });
    });
    const avancoGeral = cnt ? +(sumPct/cnt).toFixed(2) : 0;
    const services = {};
    SVC_KEYS.forEach(k => { services[k] = svcAcc[k].n ? Math.round(svcAcc[k].s/svcAcc[k].n) : 0; });
    const today = new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from('dashboard_history')
      .upsert({ snap_date: today, avanco_geral: avancoGeral, snapshot: { services, byMun } }, { onConflict: 'snap_date' });
    if (error) {
      logUpdate('dashboard_history push error: ' + error.message);
    } else {
      logUpdate('dashboard_history push ok: ' + today + ' avanco=' + avancoGeral);
    }
  } catch (e) {
    logUpdate('dashboard_history push exception: ' + e.message);
  }
}

async function getDashboardHistory() {
  try {
    const { data, error } = await supabase
      .from('dashboard_history')
      .select('snap_date, avanco_geral')
      .order('snap_date', { ascending: true });
    if (error) return { ok: false, error: error.message, data: [] };
    return { ok: true, data: data || [] };
  } catch (e) {
    return { ok: false, error: e.message, data: [] };
  }
}

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
      nodeIntegration: true,
      contextIsolation: false,
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
    if(url && url !== 'about:blank' && (url.startsWith('http')||url.startsWith('https'))) shell.openExternal(url);
    return {action:'deny'};
  });

  // F12 abre DevTools para diagnóstico
  const { globalShortcut } = require('electron');
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
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

ipcMain.on('install-update', ()=> {
  logUpdate('install-update requested — quitAndInstall');
  autoUpdater.quitAndInstall(false, true);
});

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

ipcMain.handle('select-file', async (event, filters) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: filters || [{ name: 'Todos os arquivos', extensions: ['*'] }]
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('parse-ose', async (event, { mapaDxf, perfisDxf, excelPath }) => {
  try {
    const { parseOse } = require('./parseOse');
    const data = parseOse({ mapaDxf, perfisDxf, excelPath });
    return { ok: true, data };
  } catch(e) {
    return { ok: false, error: e.message };
  }
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

const { buildOseWorkbook } = require('./exportOse');


ipcMain.handle('export-ose-xlsx', async (event, { data, projectName }) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (projectName || 'Relatório OSE') + '.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return false;
  const wb = buildOseWorkbook(data);
  await wb.xlsx.writeFile(result.filePath);
  return true;
});

// ── DASHBOARD DIRETORIA ──
const { resolveXlsxPath, parseXlsxFile } = require('./dashboardParser');

function getDashboardConfigPath() {
  return path.join(app.getPath('userData'), 'dashboard-config.json');
}
function readDashboardConfig() {
  try { return JSON.parse(fs.readFileSync(getDashboardConfigPath(), 'utf8')); } catch(_) { return {}; }
}
function writeDashboardConfig(obj) {
  try {
    fs.mkdirSync(path.dirname(getDashboardConfigPath()), { recursive: true });
    fs.writeFileSync(getDashboardConfigPath(), JSON.stringify(obj, null, 2));
  } catch(e) { logUpdate('dashboard-config write error: ' + e.message); }
}

let dashboardWatchPath = null;
let dashboardInterval = null;

function resolveDashboardPath() {
  const cfg = readDashboardConfig();
  const p = resolveXlsxPath(cfg.xlsxPath);
  if (p && p !== cfg.xlsxPath) writeDashboardConfig({ ...cfg, xlsxPath: p });
  return p;
}

function loadDashboardData() {
  const p = resolveDashboardPath();
  if (!p) return { ok: false, error: 'Planilha não encontrada. Use "Selecionar planilha manualmente".' };
  try {
    const data = parseXlsxFile(p);
    return { ok: true, data };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function setupDashboardWatcher() {
  const p = resolveDashboardPath();
  if (!p) return;
  if (dashboardWatchPath === p) return;
  try { if (dashboardWatchPath) fs.unwatchFile(dashboardWatchPath); } catch(_) {}
  dashboardWatchPath = p;
  try {
    fs.watchFile(p, { interval: 10000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        const res = loadDashboardData();
        if (res.ok) {
          mainWindow?.webContents.send('dashboard:data-updated', res.data);
          pushDashboardToSupabase(res.data);
        }
      }
    });
  } catch(e) { logUpdate('dashboard watch error: ' + e.message); }
}

ipcMain.handle('dashboard:get-data', async () => loadDashboardData());
ipcMain.handle('dashboard:get-history', async () => getDashboardHistory());

const PUBLIC_URL_FULL  = 'https://a2zproj.github.io/DASHBOARD-DIRETORIA/';
const PUBLIC_URL_SHORT_DEFAULT = 'https://is.gd/dashboard2seng';
// versão do link cacheado — incrementar invalida cache local antigo
const PUBLIC_LINK_VERSION = 2;

ipcMain.handle('dashboard:get-public-link', async () => {
  try {
    const cfg = readDashboardConfig();
    if (cfg.publicLink && cfg.publicLinkVersion === PUBLIC_LINK_VERSION) return { ok: true, url: cfg.publicLink };
    // Tenta gerar via is.gd com alias custom; se já existir/falhar usa o default
    const https = require('https');
    const apiUrl = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(PUBLIC_URL_FULL)}&shorturl=dashboard2seng`;
    const result = await new Promise((resolve) => {
      https.get(apiUrl, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(body.trim()));
      }).on('error', () => resolve(null));
    });
    const url = (result && result.startsWith('https://is.gd/')) ? result : PUBLIC_URL_SHORT_DEFAULT;
    writeDashboardConfig({ ...cfg, publicLink: url, publicLinkVersion: PUBLIC_LINK_VERSION });
    return { ok: true, url };
  } catch (e) {
    logUpdate('dashboard:get-public-link error: ' + e.message);
    return { ok: true, url: PUBLIC_URL_SHORT_DEFAULT };
  }
});

ipcMain.handle('dashboard:pick-file', async () => {
  if (!mainWindow) return { ok: false, error: 'Janela indisponível' };
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    title: 'Selecione a planilha de Acompanhamento'
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'Cancelado' };
  const cfg = readDashboardConfig();
  writeDashboardConfig({ ...cfg, xlsxPath: result.filePaths[0] });
  try { if (dashboardWatchPath) { fs.unwatchFile(dashboardWatchPath); dashboardWatchPath = null; } } catch(_) {}
  setupDashboardWatcher();
  return loadDashboardData();
});

app.whenReady().then(() => {
  setupDashboardWatcher();
  // Push inicial ao abrir
  const initRes = loadDashboardData();
  if (initRes.ok) pushDashboardToSupabase(initRes.data);
  dashboardInterval = setInterval(() => {
    const res = loadDashboardData();
    if (res.ok) {
      mainWindow?.webContents.send('dashboard:data-updated', res.data);
      pushDashboardToSupabase(res.data);
    }
    // Re-tenta configurar o watcher caso o arquivo apareça depois
    if (!dashboardWatchPath) setupDashboardWatcher();
  }, 60 * 1000); // 1 min (era 5)
});

ipcMain.on('sign-out', ()=>{
  sessionUser = null;
  updateState = { status: 'idle', version: null };
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  createSplash();
});

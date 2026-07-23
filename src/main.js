const { app, BrowserWindow, shell, ipcMain, dialog, screen, Tray, Menu, nativeImage, desktopCapturer } = require('electron');
const fs = require('fs');
const os = require('os');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const isDev = process.argv.includes('--dev');

// ── SENTRY — monitoramento de erros em produção ──
// Captura automaticamente crashes/exceções do processo MAIN de TODOS os
// usuários e manda pro painel do Sentry (stack + versão + contexto). Agrupa
// por release (nexus@X.Y.Z). O renderer é inicializado em preload.js.
//
// O DSN é a chave PÚBLICA do projeto Sentry (seguro embutir no build — só
// permite ENVIAR evento, não ler). Defina de um destes jeitos:
//   1) env var NEXUS_SENTRY_DSN
//   2) constante SENTRY_DSN abaixo (cole o DSN entre as aspas)
// Sem DSN válido = no-op total (não quebra nada).
const SENTRY_DSN = process.env.NEXUS_SENTRY_DSN || 'https://bea96e28b18dc9957ebf23cb8b11b67a@o4511641173229568.ingest.us.sentry.io/4511641179717632';
(function setupSentry() {
  if (!/^https:\/\/[^@]+@[^/]+\/\d+/.test(SENTRY_DSN)) {
    console.log('[main] Sentry desativado (sem DSN configurado)');
    return;
  }
  try {
    const Sentry = require('@sentry/electron/main');
    const ver = (require('../package.json').version || '0.0.0');
    Sentry.init({
      dsn: SENTRY_DSN,
      release: 'nexus@' + ver,
      environment: isDev ? 'development' : 'production',
      tracesSampleRate: 0,        // só erros (sem performance) — econômico no tier free
      autoSessionTracking: true,  // contagem de sessões/usuários afetados
    });
    console.log('[main] Sentry ATIVO — release nexus@' + ver);
  } catch (e) {
    console.log('[main] Sentry falhou ao iniciar: ' + (e && e.message));
  }
})();

// ── GOOGLE GEOLOCATION API KEY ──
// Sem essa key, navigator.geolocation no Electron falha silenciosamente
// (Chromium delegou pro Google location service que exige authentication).
// Origem da key (em ordem de precedência):
//   1) env var GOOGLE_GEOLOCATION_API_KEY
//   2) %USERPROFILE%\.codepro\google-key.txt (1 linha = a key)
// IMPORTANTE: precisa ser appended ANTES de app.whenReady() pra Chromium pegar.
(function setupGoogleApiKey() {
  let key = process.env.GOOGLE_GEOLOCATION_API_KEY || '';
  if (!key) {
    try {
      const p = path.join(os.homedir(), '.codepro', 'google-key.txt');
      if (fs.existsSync(p)) key = fs.readFileSync(p, 'utf8').trim();
    } catch {}
  }
  if (key) {
    app.commandLine.appendSwitch('google-api-key', key);
    console.log('[main] Google API key carregada — geolocation precisão de rua HABILITADA');
  } else {
    console.log('[main] sem Google API key — geolocation cai pra IP-based (precisão de cidade)');
  }
})();

// ── SINGLE INSTANCE LOCK ──
// Impede múltiplas instâncias do Nexus rodando ao mesmo tempo. Sem isso,
// uma install corrompida ou crash loop spawna vários processos em loop —
// o user vê "mil janelas de inicialização" e o PC trava.
// Se esta NÃO é a primeira instância, sai imediatamente.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  // Outra instância tentou subir → foca a janela existente em vez de criar outra.
  // Usa BrowserWindow.getAllWindows() como fallback se mainWindow/splashWindow
  // ainda não estiverem definidas (startup muito rápido).
  const existing = mainWindow || splashWindow || BrowserWindow.getAllWindows()[0];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
  }
});

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
    // Filtra distritos (seq tipo "20.1") — município pai já agrega seus distritos.
    const muns = (parsedData.municipalities || []).filter(m => !String(m.seq).includes('.'));
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
    // Limita a 365 snapshots (1 ano) pra Curva S — mais que isso não cabe no gráfico
    // e só onera a query. Se futuramente precisar histórico longo, paginar.
    const { data, error } = await supabase
      .from('dashboard_history')
      .select('snap_date, avanco_geral')
      .order('snap_date', { ascending: false })
      .limit(365);
    if (error) return { ok: false, error: error.message, data: [] };
    // Reordena ascendente para manter contrato com renderer
    return { ok: true, data: (data || []).sort((a, b) => a.snap_date.localeCompare(b.snap_date)) };
  } catch (e) {
    return { ok: false, error: e.message, data: [] };
  }
}

// Log de atualização para diagnóstico — com rotação a cada 1MB pra não crescer
// indefinidamente no %USERPROFILE%.
const UPDATE_LOG = path.join(os.homedir(), 'codepro-update.log');
const LOG_MAX_BYTES = 1024 * 1024; // 1MB
function logUpdate(msg) {
  try {
    // Se passou do limite, trunca pra metade (keeps últimas linhas).
    try {
      const st = fs.statSync(UPDATE_LOG);
      if (st.size > LOG_MAX_BYTES) {
        const buf = fs.readFileSync(UPDATE_LOG, 'utf8');
        fs.writeFileSync(UPDATE_LOG, buf.slice(Math.floor(buf.length / 2)));
      }
    } catch(_) {}
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(UPDATE_LOG, line);
  } catch(e) {}
}

autoUpdater.autoDownload = false;           // download controlado manualmente
autoUpdater.autoInstallOnAppQuit = false;   // NÃO instalar ao fechar sem confirmação do user (evita surpresa)

let splashWindow, mainWindow, sessionUser = null;

// Estado do update preservado entre janelas
let updateState = { status: 'idle', version: null }; // idle | available | downloading | downloaded

// ── SEGURANÇA ────────────────────────────────────────────────────────
// Bloqueia DevTools em produção para prevenir inspeção de código/chaves.
// Em dev (--dev) fica habilitado para debug.
if (!isDev) {
  app.on('web-contents-created', (_, wc) => {
    // Bloqueia abertura de DevTools
    wc.on('before-input-event', (event, input) => {
      // Bloqueia F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
      if (input.key === 'F12' ||
          (input.control && input.shift && (input.key === 'I' || input.key === 'i' || input.key === 'J' || input.key === 'j' || input.key === 'C' || input.key === 'c'))) {
        event.preventDefault();
      }
    });
    // Previne navegação para URLs externas (evita phishing/redirect)
    wc.on('will-navigate', (event, url) => {
      if (!url.startsWith('file://')) event.preventDefault();
    });
    // Previne abertura de novas janelas (exceto para impressão)
    wc.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('file://')) return { action: 'allow' };
      // Abre links externos no navegador do sistema (não no Electron)
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

let bootWindow = null;

function createBootWindow() {
  // Janela transparente fullscreen só com a logo Nexus centralizada.
  // Fecha depois de ~3s (renderer dispara o evento). Separada do splash
  // pra não quebrar o login/update se transparent: true falhar em algum PC.
  try {
    const primary = screen.getPrimaryDisplay();
    const wa = primary.workArea;
    bootWindow = new BrowserWindow({
      x: wa.x, y: wa.y, width: wa.width, height: wa.height,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      show: false,
    });
    bootWindow.loadFile(path.join(__dirname, 'boot.html'));
    bootWindow.once('ready-to-show', () => {
      if (bootWindow && !bootWindow.isDestroyed()) bootWindow.show();
    });
    bootWindow.on('closed', () => { bootWindow = null; });
  } catch (e) {
    // Se transparent quebrar, ignora e segue sem boot window
    console.warn('boot window falhou:', e.message);
    bootWindow = null;
  }
}

ipcMain.on('boot:done', () => {
  // Cria o splash DEPOIS da boot animation terminar — assim o user vê só
  // a logo transparente sozinha, sem o splash opaco por trás.
  if (!splashWindow) createSplash();
  if (bootWindow && !bootWindow.isDestroyed()) {
    try { bootWindow.close(); } catch {}
    bootWindow = null;
  }
});

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
    if(!isDev) setTimeout(()=> checkForUpdates(), 200);
  });
}

// ────────────────────────────────────────────────────────────────────
// TRAY — Nexus em segundo plano (bandeja do Windows)
// ────────────────────────────────────────────────────────────────────
let tray = null;
let isQuitting = false;
let trayBalloonShown = false;

const TRAY_PREF_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'Nexus', 'tray-pref.json');

function loadTrayPref() {
  try {
    if (fs.existsSync(TRAY_PREF_PATH)) {
      return JSON.parse(fs.readFileSync(TRAY_PREF_PATH, 'utf8')).pref || null;
    }
  } catch {}
  return null;
}

function saveTrayPref(pref) {
  try {
    fs.mkdirSync(path.dirname(TRAY_PREF_PATH), { recursive: true });
    fs.writeFileSync(TRAY_PREF_PATH, JSON.stringify({ pref, updated: new Date().toISOString() }));
  } catch {}
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
    splashWindow.focus();
  }
}

function createTray() {
  if (tray) return;
  try {
    const iconPath = path.join(__dirname, '../assets/icon.ico');
    tray = new Tray(iconPath);
    tray.setToolTip('Nexus — A2Z Projetos');
    rebuildTrayMenu();

    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());

    // Atualiza menu a cada 5s pra refletir status do Civil 3D
    setInterval(() => { try { rebuildTrayMenu(); } catch {} }, 5000);
  } catch (e) {
    logUpdate('createTray error: ' + e.message);
  }
}

function rebuildTrayMenu() {
  if (!tray) return;
  const c3dExtracted = fs.existsSync(C3D_PLUGIN_PATH);
  const menu = Menu.buildFromTemplate([
    { label: 'Nexus · A2Z Projetos', enabled: false },
    { type: 'separator' },
    { label: '🪟  Mostrar Nexus', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: c3dExtracted ? '✓  Civil 3D ativo (plugin liberado)' : '○  Civil 3D inativo',
      enabled: false,
    },
    { type: 'separator' },
    { label: '❌  Sair (encerra tudo)', click: () => quitApp() },
  ]);
  tray.setContextMenu(menu);
}

function minimizeToTray() {
  if (!tray) createTray();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();

  if (tray && !trayBalloonShown) {
    try {
      tray.displayBalloon({
        title: 'Nexus continua rodando',
        content: 'O Nexus está na bandeja (canto inferior direito). Clique no ícone pra reabrir. Civil 3D continua funcionando enquanto isso.',
        iconType: 'info',
      });
      trayBalloonShown = true;
    } catch {}
  }
}

function quitApp() {
  isQuitting = true;
  try { c3dCleanupSync(); } catch {}
  try { if (tray) { tray.destroy(); tray = null; } } catch {}
  app.quit();
}

ipcMain.handle('tray:reset-preference', () => {
  try { if (fs.existsSync(TRAY_PREF_PATH)) fs.unlinkSync(TRAY_PREF_PATH); } catch {}
  return { ok: true };
});

ipcMain.handle('tray:get-preference', () => {
  return { ok: true, pref: loadTrayPref() };
});

function createMain(licenseData){
  const licArg = licenseData
    ? `--codepro-lic=${Buffer.from(JSON.stringify(licenseData)).toString('base64')}`
    : '--codepro-lic=';

  mainWindow = new BrowserWindow({
    // Dimensões base — a janela é MAXIMIZADA no ready-to-show (ver abaixo).
    // Estes valores são o tamanho caso o user restaure da maximização.
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
      webSecurity: false,  // Necessário: renderer carrega de file:// e importa Supabase JS de https://esm.sh. Sem isso = tela branca. Segurança compensada por CSP restritivo.
      additionalArguments: [licArg],
    },
    backgroundColor: '#0f172a',
    show: false,
  });

  const licQuery = licenseData ? Buffer.from(JSON.stringify(licenseData)).toString('base64') : '';
  mainWindow.loadFile(path.join(__dirname,'app','index.html'), { query: licQuery ? { lic: licQuery } : {} });

  // Reuniões (Fase 8): wire dos handlers de permission + display-media-request
  // pra essa sessão. Sem isso, getDisplayMedia retorna "Permission denied".
  try { _wireReuniaoCapture(mainWindow); } catch (e) { console.warn('wireReuniaoCapture falhou:', e); }

  // CSP via <meta> no index.html (linhas ~50). Whitelist de connect-src pra
  // limitar exfiltração via XSS. 'unsafe-inline'/'unsafe-eval' são necessários
  // pelo nodeIntegration:true + inline scripts do app. Proteção adicional:
  // DevTools bloqueado, anti-debug, bytenode, ASAR, bloqueio de navegação/janelas.

  // Desativa DevTools em produção EXCETO via atalho secreto Ctrl+Shift+Alt+D
  // (assim o user pode debugar bugs sem dar lockdown total).
  let allowDevTools = false;
  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      if (!allowDevTools) mainWindow.webContents.closeDevTools();
    });
  }
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Ctrl+Shift+Alt+D em qualquer modo → abre DevTools
    if (input.control && input.shift && input.alt && (input.key || '').toLowerCase() === 'd') {
      allowDevTools = true;
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    // F12 só em dev
    if (isDev && input.key === 'F12') {
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
      else { allowDevTools = true; mainWindow.webContents.openDevTools(); }
    }
  });

  // Intercepta close (botão X) — pergunta se quer minimizar pra bandeja
  // ou fechar de vez. Lembra a escolha (a menos que user desmarque).
  mainWindow.on('close', (event) => {
    if (isQuitting) return;  // chamado por quitApp() ou sign-out — pode fechar

    const pref = loadTrayPref();

    if (pref === 'tray') {
      event.preventDefault();
      minimizeToTray();
      return;
    }
    if (pref === 'quit') {
      // user escolheu sempre fechar de vez → garante cleanup do Civil3D
      isQuitting = true;
      try { c3dCleanupSync(); } catch {}
      try { if (tray) { tray.destroy(); tray = null; } } catch {}
      return;
    }

    // Primeira vez (ou sem pref): pergunta
    event.preventDefault();
    const c3dActive = fs.existsSync(C3D_PLUGIN_PATH);
    const detail = c3dActive
      ? '⚠ Você está com o plugin do Civil 3D liberado!\n\n• Bandeja: Nexus continua rodando em segundo plano e o Civil 3D continua funcionando.\n• Fechar de vez: o plugin do Civil 3D vai parar de validar e o NETLOAD ficará bloqueado.'
      : '• Bandeja: Nexus continua rodando em segundo plano (necessário pra usar o Civil 3D depois).\n• Fechar de vez: encerra tudo agora.';

    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Fechar Nexus?',
      message: 'Como você quer fechar o Nexus?',
      detail,
      buttons: ['Minimizar pra bandeja', 'Fechar de vez', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      checkboxLabel: 'Lembrar minha escolha (não perguntar de novo)',
      checkboxChecked: true,
      icon: path.join(__dirname, '../assets/icon.ico'),
    }).then(result => {
      if (result.response === 2) return;  // cancelar
      const choice = result.response === 0 ? 'tray' : 'quit';
      if (result.checkboxChecked) saveTrayPref(choice);
      if (choice === 'tray') {
        minimizeToTray();
      } else {
        quitApp();
      }
    }).catch(err => logUpdate('close-dialog error: ' + err.message));
  });

  mainWindow.once('ready-to-show', ()=>{
    if(splashWindow){ splashWindow.close(); splashWindow=null; }
    mainWindow.maximize();  // abre sempre maximizado (user pediu 2026-04-18)
    mainWindow.show();
    // Sempre verifica ao abrir — se já havia um update pendente, renderer consulta via get-update-state
    if(!isDev) checkForUpdates();
    // Dashboard watcher + push inicial — adiado pra depois de mostrar a janela
    // (não bloqueia startup com I/O do xlsx do OneDrive).
    setImmediate(() => { try { initDashboardBackground(); } catch(e) { logUpdate('initDashboard error: ' + e.message); } });
  });

  mainWindow.webContents.setWindowOpenHandler(({url})=>{
    if(url && url !== 'about:blank' && (url.startsWith('http')||url.startsWith('https'))) shell.openExternal(url);
    return {action:'deny'};
  });

  // (handler de F12/Ctrl+Shift+Alt+D já registrado acima)

  mainWindow.on('closed',()=>{ mainWindow=null; });
}

ipcMain.on('splash-done', (event, licenseData)=>{
  sessionUser = licenseData;
  createMain(licenseData);
});

ipcMain.on('get-session-sync', (event)=>{
  event.returnValue = sessionUser || null;
});

// Versão do app — fallback síncrono quando o preload não consegue ler o package.json
ipcMain.on('get-app-version', (event)=>{
  event.returnValue = app.getVersion();
});

// Renderer pode consultar estado atual do update (resolve race condition)
ipcMain.on('get-update-state', (event)=>{
  event.returnValue = updateState;
});

app.whenReady().then(()=>{
  // Fase D: permite geolocation pra coletor de auditoria (precisão de rua).
  // Por default Electron nega geolocation silenciosamente; aqui aprovamos
  // automaticamente porque é app interno corporativo.
  try {
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === 'geolocation') return callback(true);
      callback(false);
    });
  } catch (e) { console.warn('setPermissionRequestHandler falhou:', e.message); }

  createBootWindow();
  // Fallback: se boot:done não chegar em 4s, cria splash de qualquer jeito
  setTimeout(() => { if (!splashWindow && !mainWindow) createSplash(); }, 4000);

  // Instala/atualiza bundle do plugin Civil 3D em segundo plano.
  // Civil 3D carrega a DLL automaticamente do %APPDATA%\Autodesk\
  // ApplicationPlugins\Nexus.bundle\ — Lucas só precisa abrir o CAD.
  setTimeout(() => { try { c3dAutoInstallBundleOnStartup(); } catch {} }, 500);

  // Espelho do Supabase (NEXUS-DADOS): baixa em 2º plano logo depois do boot e
  // reforça a cada 30 min. Nunca bloqueia a UI nem quebra se estiver sem rede.
  setTimeout(() => { atualizarCacheDadosSupabase().catch(() => {}); }, 3000);
  setInterval(() => { atualizarCacheDadosSupabase().catch(() => {}); }, 30 * 60 * 1000);
  app.on('activate',()=>{
    if(!mainWindow && !splashWindow) createSplash();
  });
});

app.on('window-all-closed',()=>{
  // Se tá rodando na bandeja (tray ativo + user pediu manter), NÃO fecha o app
  if (tray && !isQuitting) return;
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
  // NÃO baixa automaticamente — usuário decide no splash (botão "Atualizar agora")
});

// Renderer pede pra iniciar o download (após user confirmar)
ipcMain.on('download-update', () => {
  logUpdate('download-update requested');
  updateState.status = 'downloading';
  autoUpdater.downloadUpdate().catch(err => logUpdate('downloadUpdate error: ' + err));
});

// Renderer (aba Sobre) pede verificação manual
ipcMain.on('check-for-updates', () => {
  logUpdate('check-for-updates requested (manual)');
  autoUpdater.checkForUpdates().catch(err => logUpdate('manual checkForUpdates error: ' + err));
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
  logUpdate('install-update requested — quitAndInstall (silent)');
  // O TRAY segura o processo vivo mesmo sem janelas — se ele continuar ativo
  // durante quitAndInstall, o NSIS não consegue substituir o binário (em uso),
  // o pending fica no disco e na próxima abertura o updater tenta de novo:
  // loop infinito de "abre → tenta atualizar → falha → reabre". Por isso:
  //   1. isQuitting=true → window-all-closed deixa o quit rolar
  //   2. tray.destroy() → libera o processo
  //   3. removeAllListeners → defesa extra contra qualquer guard
  isQuitting = true;
  try {
    app.removeAllListeners('window-all-closed');
    if (tray) { try { tray.destroy(); } catch {} tray = null; }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  } catch (e) { logUpdate('pré-quit error: ' + e.message); }
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
});

// ── REUNIÕES (Fase 8) — desktopCapturer pra gravação de tela+áudio ──
// Estratégia (Electron 29+):
//  1) UI chama IPC 'get-screen-sources' pra mostrar picker próprio
//  2) UI escolhe source e chama 'set-source-id' pra registrar a escolha no main
//  3) UI chama navigator.mediaDevices.getDisplayMedia({video:true, audio:true})
//  4) main intercepta via setDisplayMediaRequestHandler e retorna o source escolhido
//
// Permissões 'media' e 'display-capture' precisam ser explicitamente permitidas
// pelo main process — sem isso, o Chromium nega com "Permission denied".
let _reuniaoSelectedSource = null;
// Cache pra que o setDisplayMediaRequestHandler responda síncrono — chamadas
// assíncronas dentro do handler causaram bad IPC message (reason 263) que mata
// o renderer no Electron 29 + Windows.
let _reuniaoSourcesCache = [];

ipcMain.handle('reunioes:get-screen-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    _reuniaoSourcesCache = sources; // pré-popula cache pro handler síncrono
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnailDataURL: s.thumbnail?.toDataURL?.() || null,
      appIconDataURL: s.appIcon?.toDataURL?.() || null,
      display_id: s.display_id || null,
    }));
  } catch (e) {
    console.error('[reunioes:get-screen-sources]', e);
    return [];
  }
});

ipcMain.handle('reunioes:set-source-id', (_e, id) => {
  _reuniaoSelectedSource = id || null;
  return { ok: true };
});

function _wireReuniaoCapture(win) {
  if (!win || !win.webContents) return;
  const sess = win.webContents.session;
  // Permite captura de tela + media (mic, áudio do sistema). Sem isso, Chromium nega.
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture'
        || permission === 'mediaKeySystem' || permission === 'background-sync') {
      return callback(true);
    }
    callback(false);
  });
  sess.setPermissionCheckHandler((wc, permission) => {
    if (permission === 'media' || permission === 'display-capture') return true;
    return false;
  });
  // Handler SÍNCRONO — usa cache pré-populada via 'get-screen-sources'.
  // `audio: 'loopback'` SÓ funciona quando source é tela inteira (screen:),
  // não em janela individual. Pra janelas, retornamos só vídeo — caso
  // contrário o getDisplayMedia falha com "Could not start audio source".
  sess.setDisplayMediaRequestHandler((request, callback) => {
    try {
      const sources = _reuniaoSourcesCache;
      if (!sources || sources.length === 0) {
        console.warn('[setDisplayMediaRequestHandler] cache vazia — aborta');
        return callback({});
      }
      let src = null;
      if (_reuniaoSelectedSource) src = sources.find(s => s.id === _reuniaoSelectedSource);
      if (!src) src = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      if (!src) return callback({});
      const isScreen = (src.id || '').startsWith('screen:');
      if (isScreen) {
        callback({ video: src, audio: 'loopback' });
      } else {
        callback({ video: src }); // janela individual — só vídeo
      }
    } catch (e) {
      console.error('[setDisplayMediaRequestHandler]', e);
      try { callback({}); } catch {}
    }
  }, { useSystemPicker: false });
}

// ── AUDIT LOG (escrita JSONL local + fetch IP/geo via main) ──
const auditLog = require('./auditLog');
ipcMain.handle('audit-log:append', (_e, entry) => auditLog.appendLog(entry || {}));
ipcMain.handle('audit-log:dir', () => auditLog.LOG_DIR);
ipcMain.handle('audit-log:list', () => auditLog.listLogs());
ipcMain.handle('audit-log:fetch-ip-geo', async () => {
  try { return await auditLog.fetchIpGeo(); } catch (e) { return { ip: null, geo: null, error: e.message }; }
});
ipcMain.handle('audit-log:fetch-geo-fine', async () => {
  try { return await auditLog.fetchGeoFine(); } catch (e) { return { error: e.message }; }
});

// ── CONFERÊNCIA DE ARQUIVOS ──
ipcMain.handle('select-folder', async (_e, defaultPath) => {
  if (!mainWindow) return null;
  const opts = { properties: ['openDirectory'] };
  if (defaultPath && fs.existsSync(defaultPath)) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-folders', async (_e, defaultPath) => {
  if (!mainWindow) return [];
  const opts = { properties: ['openDirectory', 'multiSelections'] };
  if (defaultPath && fs.existsSync(defaultPath)) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result.canceled ? [] : result.filePaths;
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

ipcMain.handle('select-files', async (event, filters, defaultPath) => {
  if (!mainWindow) return [];
  const opts = {
    properties: ['openFile', 'multiSelections'],
    filters: filters || [{ name: 'Todos os arquivos', extensions: ['*'] }]
  };
  if (defaultPath && fs.existsSync(defaultPath)) opts.defaultPath = defaultPath;
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('parse-ose', async (event, { mapaDxf, perfisDxf, excelPath }) => {
  try {
    const { parseOse } = require('./parseOse');
    const data = parseOse({ mapaDxf, perfisDxf, excelPath });
    return { ok: true, data };
  } catch(e) {
    // Erro estruturado quando um dos DXF não é ASCII — o renderer desenha
    // um banner vermelho com instruções de como reexportar.
    if (e && e.code === 'DXF_FORMAT') {
      return {
        ok: false,
        error: e.message,
        errorType: 'dxf_format',
        dxfFormat: e.format,
        dxfFile: e.fileName,
      };
    }
    // DXF gigante: aborta rápido com mensagem clara em vez de deixar a UI travada.
    if (e && e.code === 'DXF_TOO_LARGE') {
      return {
        ok: false,
        error: e.message,
        errorType: 'dxf_too_large',
        dxfFile: e.fileName,
        sizeMB: e.sizeMB,
      };
    }
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


ipcMain.handle('export-ose-xlsx', async (event, { data, projectName, tipoObra, excelFilename }) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (projectName || 'Relatório OSE') + '.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return false;
  const wb = buildOseWorkbook(data, { tipoObra, excelFilename });
  await wb.xlsx.writeFile(result.filePath);
  return true;
});

const { buildCronogramaWorkbook } = require('./exportCronograma');

ipcMain.handle('export-cronograma-xlsx', async (event, { rows, params, fileName }) => {
  if (!mainWindow) return false;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (fileName || 'Cronograma_2S_E-Agua') + '.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }]
  });
  if (result.canceled) return false;
  const wb = buildCronogramaWorkbook(rows || [], params || {});
  await wb.xlsx.writeFile(result.filePath);
  return true;
});

// ── A2Z Projetos · Proposta Comercial: renderiza HTML (modelo) → PDF A4 ──
// Abre uma janela oculta, carrega o HTML da proposta e usa printToPDF do
// Chromium (respeita @page A4 e print-color). Salva onde o user escolher.
ipcMain.handle('proposta:gerar-pdf', async (_e, { html, defaultName }) => {
  if (!mainWindow) return { ok: false, erro: 'sem janela principal' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: (defaultName || 'Proposta_A2Z') + '.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled) return { ok: false, canceled: true };
  let win = null;
  try {
    win = new BrowserWindow({
      show: false, width: 900, height: 1300,
      webPreferences: { offscreen: false, javascript: false },
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise(r => setTimeout(r, 400)); // deixa fontes/logo assentarem
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    require('fs').writeFileSync(result.filePath, pdf);
    try { shell.openPath(result.filePath); } catch {}
    return { ok: true, path: result.filePath };
  } catch (err) {
    return { ok: false, erro: String((err && err.message) || err) };
  } finally {
    if (win) { try { win.destroy(); } catch {} }
  }
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
    // Tenta gerar via is.gd com alias custom; se já existir/falhar usa o default.
    // Timeout de 5s pra não pendurar o renderer se is.gd estiver fora do ar.
    const https = require('https');
    const apiUrl = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(PUBLIC_URL_FULL)}&shorturl=dashboard2seng`;
    const result = await new Promise((resolve) => {
      const req = https.get(apiUrl, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(body.trim()));
      });
      req.on('error', () => resolve(null));
      req.setTimeout(5000, () => { req.destroy(); resolve(null); });
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

// Dashboard setup — ADIADO pra depois do main carregar. Antes rodava em
// app.whenReady (bloqueava startup com fs.readFileSync do xlsx do OneDrive,
// que pode ser lento se OneDrive estiver sincronizando). Agora só dispara
// quando o main estiver pronto (ver createMain → ready-to-show).
function initDashboardBackground() {
  setupDashboardWatcher();
  const initRes = loadDashboardData();
  if (initRes.ok) pushDashboardToSupabase(initRes.data);
  dashboardInterval = setInterval(() => {
    if (!dashboardWatchPath) {
      setupDashboardWatcher();
      const res = loadDashboardData();
      if (res.ok) {
        mainWindow?.webContents.send('dashboard:data-updated', res.data);
        pushDashboardToSupabase(res.data);
      }
    }
  }, 5 * 60 * 1000);
}

// ────────────────────────────────────────────────────────────────────
// CIVIL 3D — extração da DLL embedded encriptada
// ────────────────────────────────────────────────────────────────────
//
// As DLLs do plugin (uma por versão de CAD) ficam criptografadas em
// src/app/assets/civil3d-2026.bin e civil3d-2027.bin (geradas por
// scripts/embed-civil3d.js). O caminho normal é o BUNDLE, que instala as duas
// e deixa o AutoCAD escolher (ver c3dInstallBundleSync). O "Liberar Civil 3D"
// manual detecta a versão do CAD aberto e decrypta a DLL certa pra
// %APPDATA%\Nexus\plugins\ pra carregar via NETLOAD sem reabrir o CAD.
//
// Quando o Nexus fecha, a DLL é apagada (lifecycle binding).
// Sem Nexus aberto → DLL não existe no disco em formato utilizável.

const C3D_KEY_SEED = 'NexusCivil3D-A2Z-Embed-2026-v1-SecureKeyDerivation';
const C3D_PLUGIN_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'Nexus', 'plugins');
const C3D_PLUGIN_PATH = path.join(C3D_PLUGIN_DIR, 'GerarProjetoMND.dll');

// Versões de Civil 3D suportadas. Cada uma tem sua DLL própria, compilada pro
// runtime daquela versão (2026 = .NET 8 / 2027 = .NET 10), embutida num blob
// separado. No bundle, o AutoCAD escolhe a DLL certa SOZINHO via
// RuntimeRequirements (SeriesMin/Max) no PackageContents.xml — o usuário não
// precisa indicar nada. acadMajor = versão do acad.exe (25=2026, 26=2027),
// usada pra detectar qual DLL liberar no NETLOAD manual.
const C3D_TARGETS = [
  { ver: '2026', blob: 'civil3d-2026.bin', seriesMin: 'R25.1', seriesMax: 'R25.1', acadMajor: 25 },
  { ver: '2027', blob: 'civil3d-2027.bin', seriesMin: 'R26.0', seriesMax: 'R26.0', acadMajor: 26 },
];

// Bundle permanente — instalado em %APPDATA%\Autodesk\ApplicationPlugins\Nexus.bundle\
// Civil 3D carrega automaticamente sem precisar do Nexus rodar.
const C3D_BUNDLE_ROOT = path.join(os.homedir(), 'AppData', 'Roaming', 'Autodesk', 'ApplicationPlugins', 'Nexus.bundle');
const C3D_BUNDLE_CONTENTS = path.join(C3D_BUNDLE_ROOT, 'Contents', 'Civil3D');
const C3D_BUNDLE_XML = path.join(C3D_BUNDLE_ROOT, 'PackageContents.xml');
const C3D_BUNDLE_VERSION_FILE = path.join(C3D_BUNDLE_ROOT, 'Version.txt');

// Pasta da DLL no bundle pra uma versão (…\Contents\Civil3D\2026 ou \2027)
function c3dBundleDllDir(ver) { return path.join(C3D_BUNDLE_CONTENTS, ver); }
function c3dBundleDllPath(ver) { return path.join(c3dBundleDllDir(ver), 'GerarProjetoMND.dll'); }

function c3dDeriveKey() {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(C3D_KEY_SEED, 'utf8').digest();
}

function c3dDecryptBlob(blob) {
  const crypto = require('crypto');
  if (blob.length < 4 + 1 + 12 + 16 + 4) throw new Error('blob inválido');
  const magic = blob.slice(0, 4).toString('ascii');
  if (magic !== 'NXC3') throw new Error('blob com magic incorreto');
  const version = blob[4];
  if (version !== 1) throw new Error('versão do blob não suportada: ' + version);
  const iv  = blob.slice(5, 17);
  const tag = blob.slice(17, 33);
  const size = blob.readUInt32LE(33);
  const ciphertext = blob.slice(37);

  const key = c3dDeriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plain.length !== size) throw new Error('tamanho descriptografado incorreto');
  return plain;
}

function c3dGetBlobPath(blobName) {
  // No build (asar): <resources>/app.asar/src/app/assets/<blob>
  // No dev: <projeto>\src\app\assets\<blob>
  return path.join(__dirname, 'app', 'assets', blobName);
}

function c3dGetDepsSrcDir(ver) {
  return path.join(__dirname, 'app', 'assets', 'civil3d-deps', ver);
}

// Detecta a versão do AutoCAD/Civil 3D ABERTO via COM (acad.Version -> major).
// Retorna { major, ver } (ex.: 25 -> '2026', 26 -> '2027') ou null se não houver
// instância aberta. Usado só no NETLOAD manual — pra escolher a DLL certa.
function c3dDetectRunningCad() {
  try {
    const { spawnSync } = require('child_process');
    const ps = `
      $ErrorActionPreference='Stop';
      try {
        $a=[Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application');
        Write-Output $a.Version;
      } catch { Write-Output 'NONE'; }
    `.trim();
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 8000, encoding: 'utf8' });
    const out = (r.stdout || '').trim();
    if (!out || out === 'NONE') return null;
    const major = parseInt(String(out).split('.')[0], 10);
    if (!Number.isFinite(major)) return null;
    const t = C3D_TARGETS.find(x => x.acadMajor === major);
    return { major, ver: t ? t.ver : null };
  } catch { return null; }
}

ipcMain.handle('civil3d:extract', async () => {
  try {
    // NETLOAD manual só faz sentido com o CAD aberto (não dá pra carregar numa
    // instância fechada). Aproveitamos pra detectar a versão e liberar a DLL
    // CERTA (2026 ou 2027). O caminho normal é o bundle, que auto-carrega as
    // duas no startup — este botão é só pra "carregar agora sem reabrir o CAD".
    const running = c3dDetectRunningCad();
    if (!running) {
      return { ok: false, error: 'Abra o Civil 3D antes de liberar o plugin manualmente. (Pelo bundle ele carrega sozinho ao abrir.)' };
    }
    if (!running.ver) {
      return { ok: false, error: `Versão de Civil 3D não suportada (acad ${running.major}). Suportadas: 2026 e 2027.` };
    }
    const t = C3D_TARGETS.find(x => x.ver === running.ver);
    const blobPath = c3dGetBlobPath(t.blob);
    if (!fs.existsSync(blobPath)) {
      return { ok: false, error: `Blob da DLL ${t.ver} não encontrado. Build incompleto?` };
    }
    const dll = c3dDecryptBlob(fs.readFileSync(blobPath));

    fs.mkdirSync(C3D_PLUGIN_DIR, { recursive: true });
    fs.writeFileSync(C3D_PLUGIN_PATH, dll);

    return { ok: true, path: C3D_PLUGIN_PATH, size: dll.length, cadVersion: t.ver };
  } catch (e) {
    logUpdate('civil3d:extract error: ' + e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('civil3d:cleanup', async () => {
  return c3dCleanupSync();
});

ipcMain.handle('civil3d:status', async () => {
  return {
    ok: true,
    extracted: fs.existsSync(C3D_PLUGIN_PATH),
    path: C3D_PLUGIN_PATH,
  };
});

// Tenta NETLOAD automático via COM Automation do AutoCAD/Civil 3D
// Se Civil 3D não estiver aberto ou COM falhar, retorna ok:false (UI mostra
// instrução manual). Roda PowerShell pra acessar AutoCAD.Application.
ipcMain.handle('civil3d:netload', async () => {
  try {
    if (!fs.existsSync(C3D_PLUGIN_PATH)) {
      return { ok: false, error: 'DLL não foi extraída ainda' };
    }
    const { spawn } = require('child_process');
    const escapedPath = C3D_PLUGIN_PATH.replace(/'/g, "''");
    const ps = `
      $ErrorActionPreference = 'Stop';
      try {
        $acad = [Runtime.InteropServices.Marshal]::GetActiveObject('AutoCAD.Application');
        $doc  = $acad.ActiveDocument;
        $cmd  = '(command "_.NETLOAD" "' + '${escapedPath}'.Replace('\\\\','/') + '") ';
        $doc.SendCommand($cmd);
        Write-Output 'OK';
      } catch {
        Write-Output 'NO_INSTANCE';
      }
    `.trim();

    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
      let out = '';
      p.stdout.on('data', d => out += d.toString());
      p.stderr.on('data', d => out += d.toString());
      const timer = setTimeout(() => { try { p.kill(); } catch {} resolve({ ok:false, error:'timeout' }); }, 10000);
      p.on('close', () => {
        clearTimeout(timer);
        if (out.trim() === 'OK') resolve({ ok: true });
        else resolve({ ok: false, error: out.trim() || 'falha desconhecida' });
      });
    });
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

function c3dCleanupSync() {
  try {
    if (fs.existsSync(C3D_PLUGIN_PATH)) fs.unlinkSync(C3D_PLUGIN_PATH);
    return { ok: true };
  } catch (e) {
    logUpdate('civil3d:cleanup error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ────────────────────────────────────────────────────────────────────
// Bundle permanente — Civil 3D carrega no startup sem precisar do Nexus
// ────────────────────────────────────────────────────────────────────

function c3dGetBundleInstalledVersion() {
  try {
    if (!fs.existsSync(C3D_BUNDLE_VERSION_FILE)) return null;
    return fs.readFileSync(C3D_BUNDLE_VERSION_FILE, 'utf8').trim();
  } catch { return null; }
}

function c3dCopyDepsSync(srcDir, destDir) {
  try {
    if (!fs.existsSync(srcDir)) return;
    const walk = (src, dst) => {
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dst, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(d, { recursive: true });
          walk(s, d);
        } else {
          try { fs.copyFileSync(s, d); } catch (e) {
            if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
          }
        }
      }
    };
    walk(srcDir, destDir);
  } catch (e) {
    logUpdate('civil3d:bundle deps copy error: ' + e.message);
  }
}

// Instalado = XML presente E pelo menos uma DLL de versão presente.
function c3dBundleIsInstalled() {
  if (!fs.existsSync(C3D_BUNDLE_XML)) return false;
  return C3D_TARGETS.some(t => fs.existsSync(c3dBundleDllPath(t.ver)));
}

// Monta o PackageContents com um <Components> por versão instalada. O AutoCAD
// usa o RuntimeRequirements (SeriesMin/Max) pra carregar só o bloco que casa
// com a versão dele — 2026 carrega a net8, 2027 carrega a net10.
function c3dBuildPackageContents(version, vers) {
  const blocks = vers.map(ver => {
    const t = C3D_TARGETS.find(x => x.ver === ver);
    return `  <Components Description="Nexus Civil 3D ${ver}">
    <RuntimeRequirements
        OS="Win64"
        Platform="Civil3D"
        SeriesMin="${t.seriesMin}"
        SeriesMax="${t.seriesMax}" />
    <ComponentEntry
        AppName="Nexus${ver}"
        Version="${version}"
        ModuleName="./Contents/Civil3D/${ver}/GerarProjetoMND.dll"
        AppDescription="Nexus Civil 3D Plugin"
        LoadOnAutoCADStartup="True"
        PerDocument="True" />
  </Components>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<ApplicationPackage SchemaVersion="1.0"
    ProductType="Application"
    Name="Nexus"
    AppVersion="${version}"
    Description="Nexus Civil 3D Plugin — A2Z Projetos"
    Author="Lucas Nasser Santos Abdala">
  <CompanyDetails Name="A2Z Projetos" />
${blocks}
</ApplicationPackage>
`;
}

// Instala/atualiza o bundle pras DUAS versões (2026 e 2027). Idempotente — se
// já está instalado com a mesma versão e DLLs idênticas, não faz nada. Se o
// Civil 3D daquela versão estiver aberto, o write da DLL dá EBUSY e a versão
// fica pendente (retry no próximo start). Cada versão tem seu blob próprio.
function c3dInstallBundleSync() {
  try {
    const version = (require('../package.json').version || '0.0.0');
    const installedVersion = c3dGetBundleInstalledVersion();

    // DLLs descriptografadas por versão disponível (blob existe nos assets).
    const pending = [];
    for (const t of C3D_TARGETS) {
      const blobPath = c3dGetBlobPath(t.blob);
      if (!fs.existsSync(blobPath)) continue;
      pending.push({ t, dll: c3dDecryptBlob(fs.readFileSync(blobPath)) });
    }
    if (pending.length === 0) {
      return { ok: false, error: 'Nenhum blob de DLL encontrado.' };
    }

    // Skip total: mesma versão E todas as DLLs disponíveis já idênticas no bundle.
    if (installedVersion === version && fs.existsSync(C3D_BUNDLE_XML)) {
      const allSame = pending.every(({ t, dll }) => {
        try {
          const cur = fs.readFileSync(c3dBundleDllPath(t.ver));
          return cur.length === dll.length && cur.compare(dll) === 0;
        } catch { return false; }
      });
      if (allSame) return { ok: true, alreadyInstalled: true, version };
    }

    const installedVers = [];
    let busy = false;
    for (const { t, dll } of pending) {
      const dir = c3dBundleDllDir(t.ver);
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(c3dBundleDllPath(t.ver), dll);
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') { busy = true; continue; }
        throw e;
      }
      c3dCopyDepsSync(c3dGetDepsSrcDir(t.ver), dir);
      installedVers.push(t.ver);
    }

    if (installedVers.length === 0) {
      // Todas as versões disponíveis estavam travadas (CAD aberto).
      return { ok: false, restartCad: true,
        error: 'Civil 3D está aberto. Feche-o pra atualizar a DLL.' };
    }

    fs.writeFileSync(C3D_BUNDLE_XML, c3dBuildPackageContents(version, installedVers));
    // Só carimba a versão se TODAS as disponíveis entraram — senão deixa pendente
    // pro próximo start reescrever as que faltaram.
    if (!busy) fs.writeFileSync(C3D_BUNDLE_VERSION_FILE, version + '\n');

    logUpdate(`civil3d:bundle: instalado v${version} [${installedVers.join(',')}]${busy ? ' (parcial — CAD aberto)' : ''}`);
    return { ok: true, version, path: C3D_BUNDLE_ROOT, versions: installedVers, restartCad: busy };
  } catch (e) {
    logUpdate('civil3d:bundle install error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

// Flag levantada quando o auto-install detecta que o Civil 3D estava aberto e
// segurou a DLL antiga (write deu EBUSY). Significa que o bundle está stale —
// o user precisa fechar o CAD e abrir o Nexus de novo pra DLL nova entrar.
let _c3dNeedsCadRestart = false;

function _c3dEmitNeedsCadRestartToAllWindows() {
  if (!_c3dNeedsCadRestart) return;
  try {
    const wins = require('electron').BrowserWindow.getAllWindows();
    for (const w of wins) {
      try { w.webContents.send('civil3d:bundle:needs-cad-restart'); } catch {}
    }
  } catch {}
}

ipcMain.handle('civil3d:bundle:status', async () => {
  return {
    ok: true,
    installed: c3dBundleIsInstalled(),
    version: c3dGetBundleInstalledVersion(),
    path: C3D_BUNDLE_ROOT,
    nexusVersion: (require('../package.json').version || '0.0.0'),
    needsCadRestart: _c3dNeedsCadRestart,
  };
});

ipcMain.handle('civil3d:bundle:install', async () => {
  return c3dInstallBundleSync();
});

ipcMain.handle('civil3d:bundle:uninstall', async () => {
  try {
    if (fs.existsSync(C3D_BUNDLE_ROOT)) {
      fs.rmSync(C3D_BUNDLE_ROOT, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      return { ok: false, restartCad: true, error: 'Civil 3D aberto.' };
    }
    return { ok: false, error: e.message };
  }
});

// ── TOPOGRAFIA: Relatórios em lote a partir de TXTs GNSS RTK ──
// Roda no main process pq usa chartjs-node-canvas (canvas nativo) + docx.
// Carregamento lazy: só require quando o usuário ativa o fluxo TXT.
ipcMain.handle('topografia:listar-cidades', async (_e, pastaRaiz) => {
  try {
    if (!pastaRaiz || !fs.existsSync(pastaRaiz)) return { ok: false, error: 'Pasta não encontrada' };

    // Conta .txt recursivamente em uma pasta (o processador também varre recursivo).
    const contarTxtRecursivo = (dir) => {
      let total = 0;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) total += contarTxtRecursivo(full);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) total++;
        }
      } catch {}
      return total;
    };

    // Limpa nome da cidade: tira prefixo "NNN.", "NNN-", "NNN_" se houver e normaliza espaços.
    const limparNome = (raw) => (raw || '').replace(/^\s*\d+\s*[.\-_]\s*/, '').trim() || raw;

    const entries = fs.readdirSync(pastaRaiz, { withFileTypes: true });
    const subdirsComTxt = entries
      .filter(d => d.isDirectory())
      .map(d => {
        const dir = path.join(pastaRaiz, d.name);
        return { pasta: dir, nome: limparNome(d.name), qtdTxt: contarTxtRecursivo(dir) };
      })
      .filter(c => c.qtdTxt > 0);

    // Caso 1: pasta-raiz com subpastas/cidade — devolve a lista das subpastas.
    if (subdirsComTxt.length > 0) {
      return { ok: true, cidades: subdirsComTxt };
    }

    // Caso 2: pasta apontada É uma cidade (TXTs diretos dentro).
    const qtdDireto = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.txt')).length;
    if (qtdDireto > 0) {
      return {
        ok: true,
        cidades: [{ pasta: pastaRaiz, nome: limparNome(path.basename(pastaRaiz)), qtdTxt: qtdDireto }],
      };
    }

    return { ok: true, cidades: [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('topografia:gerar-lote', async (event, { cidades, pastaSaida, assinatura, uf, incluirMapa3D }) => {
  try {
    const { gerarRelatorioCidade } = require('./modulos/topografia/src');
    // Sanitiza nome de cidade pra pasta válida no Windows
    const sanitize = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim() || 'sem-nome';

    const cidadesIn = (cidades || []).map(c => ({
      pastaCidade: c.pasta,
      municipio: c.municipio || c.nome,
      uf: c.uf || uf || 'PR',
      extensaoKm: c.extensaoKm,
      mapaAbrangenciaPng: c.mapaAbrangenciaPng || undefined,
      fotosEquipe: Array.isArray(c.fotosEquipe) ? c.fotosEquipe : [],
      artImagens: Array.isArray(c.artImagens) ? c.artImagens : [],
      // toggle por-cidade cai pro toggle global; default = true
      incluirMapa3D: (c.incluirMapa3D ?? incluirMapa3D) !== false,
    }));

    const debug = cidadesIn.map(c => ({
      municipio: c.municipio,
      fotos_enviadas: (c.fotosEquipe || []).length,
      fotos_existem: (c.fotosEquipe || []).filter(f => f.caminho && fs.existsSync(f.caminho)).length,
      art_enviada: (c.artImagens || []).length,
      mapa: c.mapaAbrangenciaPng ? path.basename(c.mapaAbrangenciaPng) : null,
    }));
    try { console.log('[topografia:gerar-lote] payload:', JSON.stringify(debug, null, 2)); } catch {}

    // Cada cidade vai pra subpasta "RELATÓRIOS - <Município>" dentro de pastaSaida.
    const resultados = [];
    const total = cidadesIn.length;
    for (let idx = 0; idx < total; idx++) {
      const c = cidadesIn[idx];
      const cidadePastaSaida = path.join(pastaSaida, 'RELATÓRIOS - ' + sanitize(c.municipio));
      try {
        const r = await gerarRelatorioCidade({
          ...c,
          pastaSaida: cidadePastaSaida,
          onProgresso: (etapa, pct) => {
            try { event.sender.send('topografia:progresso', { municipio: c.municipio, idx, total, etapa, pct }); } catch {}
          },
        });
        resultados.push({ municipio: c.municipio, sucesso: true, caminhoDocx: r.caminhoDocx });
      } catch (err) {
        resultados.push({ municipio: c.municipio, sucesso: false, erro: err.message });
      }
    }

    return { ok: true, resultados, debug };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Pré-visualização: gera DOCX (pra UMA cidade) numa pasta temp e devolve o caminho.
// O renderer lê esse arquivo via fs e renderiza com docx-preview embed dentro do app.
ipcMain.handle('topografia:preview-cidade', async (event, params) => {
  try {
    const { gerarRelatorioCidade } = require('./modulos/topografia/src');
    const tmpRoot = path.join(app.getPath('temp'), 'nexus-topo-preview');
    if (!fs.existsSync(tmpRoot)) fs.mkdirSync(tmpRoot, { recursive: true });
    const pastaSaida = path.join(tmpRoot, 'preview-' + Date.now());
    fs.mkdirSync(pastaSaida, { recursive: true });
    const r = await gerarRelatorioCidade({
      pastaCidade: params.pasta,
      municipio: params.municipio || params.nome,
      uf: params.uf || 'PR',
      pastaSaida,
      extensaoKm: params.extensaoKm,
      mapaAbrangenciaPng: params.mapaAbrangenciaPng || undefined,
      fotosEquipe: Array.isArray(params.fotosEquipe) ? params.fotosEquipe : [],
      artImagens: Array.isArray(params.artImagens) ? params.artImagens : [],
      incluirMapa3D: params.incluirMapa3D !== false,
      onProgresso: (etapa, pct) => {
        try { event.sender.send('topografia:progresso', { municipio: params.municipio || params.nome, idx: 0, total: 1, etapa, pct }); } catch {}
      },
    });
    const buf = fs.readFileSync(r.caminhoDocx);
    return { ok: true, caminho: r.caminhoDocx, base64: buf.toString('base64'), stats: r.stats };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Escaneia pasta de fotos e tenta auto-detectar data + equipe.
// Procura padrão de data (DD-MM-YYYY/YY com separadores . _ - /) e equipe
// (Equipe NN / EqNN) PRIMEIRO no nome do arquivo, depois no nome da pasta-pai,
// depois na pasta-avó. Usuário organiza por pastas com nomes tipo "Equipe 01 - 11-12-2025".
ipcMain.handle('topografia:scan-fotos', async (_e, pastaFotos) => {
  try {
    if (!pastaFotos || !fs.existsSync(pastaFotos)) return { ok: false, error: 'Pasta não encontrada' };
    const exts = new Set(['.jpg', '.jpeg', '.png']);
    // Prefere ISO YYYY-MM-DD (4 dígitos primeiro), cai pra BR DD-MM-YYYY.
    const reDataISO = /(?:^|[^0-9])(20\d{2})[-_./](\d{2})[-_./](\d{2})(?:[^0-9]|$)/;
    const reDataBR  = /(?:^|[^0-9])(\d{2})[-_./](\d{2})[-_./](\d{2,4})(?:[^0-9]|$)/;
    const reEquipe = /(?:equipe|eq)\s*[_\s-]?(\d{1,3})/i;
    const ano4 = (y) => y.length === 2 ? ('20' + y) : y;

    const extrair = (str) => {
      if (!str) return { data: null, equipe: null };
      let data = null;
      const mISO = str.match(reDataISO);
      if (mISO) {
        // YYYY-MM-DD → DD/MM/YYYY
        data = `${mISO[3]}/${mISO[2]}/${mISO[1]}`;
      } else {
        const mBR = str.match(reDataBR);
        if (mBR) data = `${mBR[1]}/${mBR[2]}/${ano4(mBR[3])}`;
      }
      const mEq = str.match(reEquipe);
      return {
        data,
        equipe: mEq ? `Equipe ${String(parseInt(mEq[1], 10)).padStart(2, '0')}` : null,
      };
    };

    const pastaPaiNome = path.basename(pastaFotos);
    const pastaAvoNome = path.basename(path.dirname(pastaFotos));
    const ctxPai = extrair(pastaPaiNome);
    const ctxAvo = extrair(pastaAvoNome);

    const arquivos = fs.readdirSync(pastaFotos, { withFileTypes: true })
      .filter(e => e.isFile())
      .filter(e => exts.has(path.extname(e.name).toLowerCase()));

    const fotos = arquivos.map(e => {
      const baseNoExt = path.basename(e.name, path.extname(e.name));
      const ctxArq = extrair(baseNoExt);
      const data = ctxArq.data || ctxPai.data || ctxAvo.data;
      const equipe = ctxArq.equipe || ctxPai.equipe || ctxAvo.equipe;
      return {
        caminho: path.join(pastaFotos, e.name),
        nome: e.name,
        data, equipe,
        valido: !!(data && equipe),
        origem: ctxArq.data && ctxArq.equipe ? 'arquivo' : (ctxPai.data || ctxPai.equipe ? 'pasta' : 'avo'),
      };
    });

    return { ok: true, fotos };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Config persistente do módulo topografia (ART do contrato, caminhos default, etc.)
function getTopografiaConfigPath() {
  return path.join(app.getPath('userData'), 'topografia-config.json');
}
function readTopografiaConfig() {
  try { return JSON.parse(fs.readFileSync(getTopografiaConfigPath(), 'utf8')); } catch (_) { return {}; }
}
function writeTopografiaConfig(obj) {
  try {
    fs.mkdirSync(path.dirname(getTopografiaConfigPath()), { recursive: true });
    fs.writeFileSync(getTopografiaConfigPath(), JSON.stringify(obj, null, 2));
  } catch (e) { logUpdate('topografia-config write error: ' + e.message); }
}

ipcMain.handle('topografia:config-get', async () => {
  return readTopografiaConfig();
});
ipcMain.handle('topografia:config-set', async (_e, patch) => {
  const cur = readTopografiaConfig();
  writeTopografiaConfig({ ...cur, ...patch });
  return { ok: true };
});

// Mesma lógica de extração mas pra lista de arquivos individuais (usuário entrou na pasta
// e selecionou as fotos no Explorer). Tenta extrair data/equipe do nome do arquivo e
// cai pra nome da pasta-pai/avó como fallback.
ipcMain.handle('topografia:scan-fotos-arquivos', async (_e, caminhos) => {
  try {
    const arr = Array.isArray(caminhos) ? caminhos : [caminhos];
    const exts = new Set(['.jpg', '.jpeg', '.png']);
    // Prefere ISO YYYY-MM-DD (4 dígitos primeiro), cai pra BR DD-MM-YYYY.
    const reDataISO = /(?:^|[^0-9])(20\d{2})[-_./](\d{2})[-_./](\d{2})(?:[^0-9]|$)/;
    const reDataBR  = /(?:^|[^0-9])(\d{2})[-_./](\d{2})[-_./](\d{2,4})(?:[^0-9]|$)/;
    const reEquipe = /(?:equipe|eq)\s*[_\s-]?(\d{1,3})/i;
    const ano4 = (y) => y.length === 2 ? ('20' + y) : y;
    const extrair = (str) => {
      if (!str) return { data: null, equipe: null };
      let data = null;
      const mISO = str.match(reDataISO);
      if (mISO) {
        // YYYY-MM-DD → DD/MM/YYYY
        data = `${mISO[3]}/${mISO[2]}/${mISO[1]}`;
      } else {
        const mBR = str.match(reDataBR);
        if (mBR) data = `${mBR[1]}/${mBR[2]}/${ano4(mBR[3])}`;
      }
      const mEq = str.match(reEquipe);
      return {
        data,
        equipe: mEq ? `Equipe ${String(parseInt(mEq[1], 10)).padStart(2, '0')}` : null,
      };
    };

    const fotos = arr
      .filter(cam => cam && fs.existsSync(cam) && exts.has(path.extname(cam).toLowerCase()))
      .map(cam => {
        const dir = path.dirname(cam);
        const nome = path.basename(cam);
        const baseNoExt = path.basename(nome, path.extname(nome));
        const ctxArq = extrair(baseNoExt);
        const ctxPai = extrair(path.basename(dir));
        const ctxAvo = extrair(path.basename(path.dirname(dir)));
        const data = ctxArq.data || ctxPai.data || ctxAvo.data;
        const equipe = ctxArq.equipe || ctxPai.equipe || ctxAvo.equipe;
        return {
          caminho: cam,
          nome,
          data, equipe,
          valido: !!(data && equipe),
          origem: ctxArq.data && ctxArq.equipe ? 'arquivo' : (ctxPai.data || ctxPai.equipe ? 'pasta' : 'avo'),
        };
      });
    return { ok: true, fotos };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ART: aceita PDF (converte cada página em PNG via pdf-to-png-converter) ou PNG/JPG direto.
// Retorna paths absolutos de PNGs prontos pra serem injetados no template.
ipcMain.handle('topografia:converter-art', async (_e, caminhos) => {
  try {
    const arr = Array.isArray(caminhos) ? caminhos : [caminhos];
    const resultadoPngs = [];
    for (const cam of arr) {
      if (!cam || !fs.existsSync(cam)) continue;
      const ext = path.extname(cam).toLowerCase();
      if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
        resultadoPngs.push(cam);
        continue;
      }
      if (ext === '.pdf') {
        try {
          // Polyfill — pdf-to-png-converter usa pdfjs que precisa DOMMatrix/ImageData/Path2D.
          // Em Node esses globais não existem; @napi-rs/canvas fornece. Idempotente.
          try {
            const _napi = require('@napi-rs/canvas');
            if (!global.DOMMatrix && _napi.DOMMatrix) global.DOMMatrix = _napi.DOMMatrix;
            if (!global.ImageData && _napi.ImageData) global.ImageData = _napi.ImageData;
            if (!global.Path2D && _napi.Path2D) global.Path2D = _napi.Path2D;
            if (!global.DOMPoint && _napi.DOMPoint) global.DOMPoint = _napi.DOMPoint;
            if (!global.DOMRect && _napi.DOMRect) global.DOMRect = _napi.DOMRect;
          } catch {}
          const { pdfToPng } = require('pdf-to-png-converter');
          const outDir = path.join(app.getPath('temp'), 'nexus-art-' + Date.now());
          fs.mkdirSync(outDir, { recursive: true });
          const pages = await pdfToPng(cam, {
            outputFolder: outDir,
            outputFileMask: 'art_pagina',
            viewportScale: 2.0,
          });
          for (const p of pages) resultadoPngs.push(p.path);
        } catch (e) {
          return { ok: false, error: `Falha ao converter PDF ${path.basename(cam)}: ${e.message}` };
        }
      }
    }
    return { ok: true, pngs: resultadoPngs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('topografia:abrir-pasta', async (_e, p) => {
  try { await shell.openPath(p); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// ORÇAMENTO RCE — gera o orçamento de Rede Coletora de Esgoto a partir de
// um arquivo de OSEs (.xlsx), chamando o gerador Python
// (scripts/orcamento/gerar_orcamento_rce.py). Padrão isolado: handlers com
// prefixo "orc-rce:" pra não colidir com a aba Orçamento (Supabase) existente.
// ────────────────────────────────────────────────────────────────────

// >>> PONTO ÚNICO DE CONFIGURAÇÃO DO PYTHON <<<
// Ordem de tentativa: 1) candidatos abaixo (1º que existir/responder), 2) "python"
// no PATH, 3) "py -3" (launcher Windows). Edite/adicione caminhos aqui se mudar.
// ⚠ ANTES daqui os caminhos eram FIXOS em C:\Users\lcabd\... — só funcionava na máquina
// do Lucas. Na do Gustavo (usuário diferente) nada era encontrado e o app pedia
// "Instale o Python 3", mesmo com o Python instalado: o instalador oficial NÃO marca
// "Add to PATH" por padrão, então o fallback do PATH também falhava.
// Agora a busca é dinâmica: env → pastas padrão (por usuário e por máquina) → registro.
function _pyCandidatos() {
  const out = [];
  const add = p => { if (p && !out.includes(p)) out.push(p); };
  add(process.env.NEXUS_PYTHON || '');

  // pastas onde o instalador oficial põe o Python, do mais novo pro mais antigo
  const raizes = [
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || '',
    'C:\\',
  ].filter(Boolean);
  for (const r of raizes) {
    let nomes = [];
    try { nomes = fs.readdirSync(r).filter(n => /^Python\s?3[\d.]*$/i.test(n)); } catch { continue; }
    nomes.sort().reverse();                        // Python313 antes de Python311
    for (const n of nomes) add(path.join(r, n, 'python.exe'));
  }

  // registro: pega instalações que não estão nas pastas padrão
  try {
    const { execFileSync } = require('child_process');
    for (const hive of ['HKCU', 'HKLM']) {
      let saida = '';
      try {
        saida = execFileSync('reg', ['query', `${hive}\\Software\\Python\\PythonCore`, '/s', '/v', 'ExecutablePath'],
                             { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { continue; }
      for (const m of saida.matchAll(/ExecutablePath\s+REG_SZ\s+(.+?)\s*$/gmi)) add(m[1].trim());
    }
  } catch {}

  return out;
}
// O stub do WindowsApps é um reparse point de 0 byte que só abre a Microsoft Store —
// se entrar como "python válido", o app trava esperando um processo que não faz nada.
function _pyUtilizavel(p) {
  try {
    if (!p || !fs.existsSync(p)) return false;
    if (/[\\/]WindowsApps[\\/]/i.test(p)) return false;
    const st = fs.statSync(p);
    return st.isFile() && st.size > 0;
  } catch { return false; }
}

function orcRceResolveScript() {
  // dev: <repo>/scripts/orcamento ; packaged: extraResources -> resourcesPath/scripts/orcamento
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'orcamento', 'gerar_orcamento_rce.py'),
    path.join(process.resourcesPath || '', 'scripts', 'orcamento', 'gerar_orcamento_rce.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'orcamento', 'gerar_orcamento_rce.py'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

let _pyCache;
function orcRceResolvePython() {
  if (_pyCache !== undefined) return _pyCache;
  const { execFileSync } = require('child_process');
  const testa = (cmd, args) => {
    try {
      execFileSync(cmd, [...args, '--version'], { stdio: 'ignore', windowsHide: true, timeout: 8000 });
      return true;
    } catch { return false; }
  };

  // 1) caminhos absolutos (env → pastas padrão → registro); confirma que EXECUTA mesmo
  for (const c of _pyCandidatos()) {
    if (_pyUtilizavel(c) && testa(c, [])) { _pyCache = { cmd: c, args: [] }; break; }
  }
  // 2) launcher "py -3" (existe mesmo sem PATH; é o mais confiável no Windows)
  if (!_pyCache && testa('py', ['-3'])) _pyCache = { cmd: 'py', args: ['-3'] };
  // 3) "python" do PATH, por último (pode ser o stub da Store)
  if (!_pyCache && testa('python', [])) _pyCache = { cmd: 'python', args: [] };

  if (_pyCache) logUpdate('python: usando ' + _pyCache.cmd + ' ' + _pyCache.args.join(' '));
  else { logUpdate('python: NAO encontrado'); _pyCache = null; }
  return _pyCache;
}
// permite reavaliar sem reiniciar o app (ex.: usuário acabou de instalar o Python)
ipcMain.handle('nexus:python-redetectar', async () => {
  _pyCache = undefined;
  const r = orcRceResolvePython();
  return { ok: !!r, python: r ? `${r.cmd} ${r.args.join(' ')}`.trim() : null, candidatos: _pyCandidatos() };
});

ipcMain.handle('orc-rce:select-oses', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar arquivo de OSEs',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('orc-rce:pick-save', async (_e, defaultName) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar orçamento RCE',
    defaultPath: defaultName || 'Orcamento_RCE.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('orc-rce:gerar', async (_e, cfg) => {
  try {
    cfg = cfg || {};
    if (!cfg.oses)  return { ok: false, erro: 'Arquivo de OSEs não informado.' };
    if (!cfg.saida) return { ok: false, erro: 'Caminho de saída não informado.' };
    if (cfg.ligacoes == null || cfg.ligacoes === '')
      return { ok: false, erro: 'Nº de ligações prediais não informado.' };

    const script = orcRceResolveScript();
    if (!script) return { ok: false, erro: 'Gerador Python não encontrado (scripts/orcamento/gerar_orcamento_rce.py).' };

    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    // grava config.json num tmp
    const tmpJson = path.join(os.tmpdir(), `nexus_orc_rce_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(cfg, null, 2), 'utf8');

    const { spawn } = require('child_process');
    const args = [...py.args, script, '--config', tmpJson];

    return await new Promise((resolve) => {
      let out = '', err = '';
      let proc;
      try {
        proc = spawn(py.cmd, args, { windowsHide: true });
      } catch (e) {
        try { fs.unlinkSync(tmpJson); } catch {}
        return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message });
      }
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => err += d.toString());
      proc.on('error', (e) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message });
      });
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        // última linha não-vazia do stdout = JSON
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try { parsed = JSON.parse(lines[i]); break; } catch {}
        }
        if (parsed && typeof parsed === 'object') {
          resolve(parsed);
        } else {
          resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1200) });
        }
      });
    });
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('orc-rce:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// ORÇAMENTO ELEVATÓRIA (EEE) — gera o orçamento de Estação Elevatória a
// partir do gabarito A2 + DADOS DE ENTRADA do projeto, chamando o wrapper
// Python (scripts/orcamento-elevatoria/gerar_orcamento_elevatoria.py), que
// monta o config e roda o engine (Excel COM). Padrão isolado "orc-elev:".
// Reusa o resolvedor de Python do RCE (orcRceResolvePython). Progresso do
// engine (Custo/TOTAL/xlsx/pdf) sobe por 'orc-elev:progresso'; última
// linha do stdout = JSON com {ok,xlsx,pdfs,total,...}.
// ────────────────────────────────────────────────────────────────────
function orcElevResolveScript() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'orcamento-elevatoria', 'gerar_orcamento_elevatoria.py'),
    path.join(process.resourcesPath || '', 'scripts', 'orcamento-elevatoria', 'gerar_orcamento_elevatoria.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'orcamento-elevatoria', 'gerar_orcamento_elevatoria.py'),
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}
function orcElevA2Default() {
  // gabarito A2 empacotado em scripts/orcamento-elevatoria/assets/
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'orcamento-elevatoria', 'assets', '01 - ORC. ELEVATÓRIA_A2.xlsx'),
    path.join(process.resourcesPath || '', 'scripts', 'orcamento-elevatoria', 'assets', '01 - ORC. ELEVATÓRIA_A2.xlsx'),
    path.join(app.getAppPath(), '..', 'scripts', 'orcamento-elevatoria', 'assets', '01 - ORC. ELEVATÓRIA_A2.xlsx'),
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}

ipcMain.handle('orc-elev:a2-default', async () => {
  const p = orcElevA2Default();
  return { ok: !!p, path: p || null };
});

ipcMain.handle('orc-elev:schema', async () => {
  // schema do formulário (DADOS DE ENTRADA + CP) + defaults da família Altamira,
  // gerado por scripts/orcamento-elevatoria/_gen_form_schema.py em assets/form_schema.json.
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'orcamento-elevatoria', 'assets', 'form_schema.json'),
    path.join(process.resourcesPath || '', 'scripts', 'orcamento-elevatoria', 'assets', 'form_schema.json'),
    path.join(app.getAppPath(), '..', 'scripts', 'orcamento-elevatoria', 'assets', 'form_schema.json'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return { ok: true, data: JSON.parse(fs.readFileSync(c, 'utf8')) }; } catch (e) { return { ok: false, erro: e.message }; }
  }
  return { ok: false, erro: 'form_schema.json não encontrado.' };
});

ipcMain.handle('orc-elev:pick-a2', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar gabarito A2 (.xlsx)',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('orc-elev:pick-pdf', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar projeto(s) — pode escolher vários PDFs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  return result.canceled ? [] : result.filePaths;   // array (seleção múltipla)
});

ipcMain.handle('orc-elev:pick-save', async (_e, defaultName) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar orçamento da Elevatória',
    defaultPath: defaultName || 'ORC_EEE.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('orc-elev:gerar', async (event, cfg) => {
  try {
    cfg = cfg || {};
    if (!cfg.SB)       return { ok: false, erro: 'Identificação (SB) não informada.' };
    if (!cfg.A2_PATH)  return { ok: false, erro: 'Gabarito A2 não informado.' };
    if (!cfg.OUT_XLSX) return { ok: false, erro: 'Caminho de saída não informado.' };
    if (!cfg.DATA || typeof cfg.DATA !== 'object') return { ok: false, erro: 'DADOS DE ENTRADA ausentes.' };
    if (!fs.existsSync(cfg.A2_PATH)) return { ok: false, erro: 'Gabarito A2 não encontrado: ' + cfg.A2_PATH };

    const script = orcElevResolveScript();
    if (!script) return { ok: false, erro: 'Wrapper Python não encontrado (scripts/orcamento-elevatoria/gerar_orcamento_elevatoria.py).' };

    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    const tmpJson = path.join(os.tmpdir(), `nexus_orc_elev_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(cfg, null, 2), 'utf8');

    const { spawn } = require('child_process');
    const args = [...py.args, script, '--config', tmpJson];
    const send = (m) => { try { event.sender.send('orc-elev:progresso', m); } catch {} };

    return await new Promise((resolve) => {
      let out = '', err = '', proc;
      try {
        proc = spawn(py.cmd, args, {
          windowsHide: true, cwd: path.dirname(script),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
      } catch (e) {
        try { fs.unlinkSync(tmpJson); } catch {}
        return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message });
      }
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', d => { out += d; d.split(/\r?\n/).forEach(l => { l = l.trim(); if (l && l[0] !== '{') send(l); }); });
      proc.stderr.on('data', d => { err += d; d.split(/\r?\n/).forEach(l => { l = l.trim(); if (l) send('⚠ ' + l); }); });
      proc.on('error', (e) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message });
      });
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) { try { parsed = JSON.parse(lines[i]); break; } catch {} }
        if (parsed && typeof parsed === 'object') resolve(parsed);
        else resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1500) });
      });
    });
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('orc-elev:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// ORÇAMENTO ELEVATÓRIA — BANCO DE COTAÇÕES (acumulável e compartilhado).
// Fonte de verdade = JSON no SERVIDOR (todos os PCs acessam + é o arquivo
// que o Claude lê p/ consolidar na memória). Fallback = userData local se
// o servidor estiver indisponível; na leitura une os dois (dedup por id)
// p/ não perder o que foi cadastrado offline.
// ────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────
// PASTA DE DADOS COMPARTILHADOS DO NEXUS (análises/cotações/fornecedores).
// Migrado do servidor Maringá (SMB \\2s-eng-servidor, exigia Tailscale/VPN)
// para o OneDrive da 2S, que sincroniza sozinho em toda máquina — resolve o
// acesso p/ quem não está na rede. Resolve o root do OneDrive "2S ENGENHARIA"
// em qualquer PC (env override → registro do OneDrive → %USERPROFILE%) e cai
// no servidor SMB antigo só por compatibilidade se o OneDrive não existir.
// Override manual: variável de ambiente NEXUS_ONEDRIVE_2S.
// ────────────────────────────────────────────────────────────────────
// Sufixo constante dos dados dentro da biblioteca do SharePoint. O 1º segmento (nome da
// biblioteca) VARIA por usuário: no Lucas é "001. SERVIDOR PARANÁ"; no Gustavo é
// "01 - Arquivos Engenharia - 001. SERVIDOR PARANÁ". Por isso NÃO dá p/ fixar o caminho
// inteiro — procuramos este sufixo debaixo de qualquer pasta de 1º nível do OneDrive 2S.
const NEXUS_DADOS_TAIL = path.join('002. ACCIONA', '001. BLOCO 02', '_APOIO', 'NEXUS-DADOS');
const NEXUS_DADOS_SERVER_LEGACY = '\\\\2s-eng-servidor\\maringa\\_PROGRAMAS';
// TODAS as raízes de OneDrive da máquina. NÃO exige "2S ENGENHARIA" no nome da conta
// (o rótulo do tenant varia); só ordena colocando as que citam 2S na frente.
function oneDriveRoots() {
  const roots = [];
  const add = p => { try { if (p && fs.existsSync(p) && !roots.includes(p)) roots.push(p); } catch {} };
  add(process.env.NEXUS_ONEDRIVE_2S);
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s'], { encoding: 'utf8', windowsHide: true });
    const blocos = out.split(/\r?\n\s*\r?\n/);
    for (const preferido of [true, false]) {
      for (const b of blocos) {
        if (/2S ENGENHARIA/i.test(b) !== preferido) continue;
        const m = b.match(/UserFolder\s+REG_SZ\s+(.+?)\s*$/mi);
        if (m) add(m[1].trim());
      }
    }
  } catch {}
  try {
    const home = os.homedir();
    for (const n of fs.readdirSync(home)) if (/^OneDrive/i.test(n)) add(path.join(home, n));
  } catch {}
  return roots;
}
function oneDrive2SRoot() { return oneDriveRoots()[0] || null; }   // compat

// A pasta é reconhecida pelo CONTEÚDO, não pelo caminho.
function ehPastaDados(p) {
  try {
    return fs.existsSync(path.join(p, 'NEXUS-ANALISES'))
        || fs.existsSync(path.join(p, 'COTACOES NEXUS'))
        || fs.existsSync(path.join(p, 'FORNECEDORES NEXUS'));
  } catch { return false; }
}
// Busca em largura, com profundidade e nº de pastas limitados, priorizando os nomes do
// caminho conhecido. Assim funciona seja qual for o ponto de sincronização do usuário:
// a biblioteca inteira, só "002. ACCIONA", só "001. BLOCO 02" ou até direto no _APOIO.
const DADOS_DIRNAME = 'NEXUS-DADOS';
const ORC_EEE_SUBS = ['NEXUS', '_UPDATE_NEXUS', 'COTAÇÕES', 'PREÇOS SANEPAR'];
const PISTAS = /(ACCIONA|BLOCO|_APOIO|APOIO|SERVIDOR|ENGENHARIA|PARAN|OR[ÇC]AMENTO)/i;
function buscarPasta(root, nomePasta, valida, maxDepth = 6, maxDirs = 4000) {
  const alvo = nomePasta.toLowerCase();
  let visitados = 0;
  const fila = [[root, 0]];
  while (fila.length) {
    const [dir, d] = fila.shift();
    if (++visitados > maxDirs) break;
    let itens;
    try { itens = fs.readdirSync(dir); } catch { continue; }
    const filhos = [];
    for (const nome of itens) {
      if (nome.startsWith('.') || /^(node_modules|\$RECYCLE\.BIN|System Volume Information)$/i.test(nome)) continue;
      const p = path.join(dir, nome);
      if (nome.toLowerCase() === alvo && valida(p)) return p;
      if (d < maxDepth) filhos.push([p, d + 1, PISTAS.test(nome) ? 0 : 1]);
    }
    filhos.sort((a, b) => a[2] - b[2]);           // nomes do caminho conhecido primeiro
    for (const [p, nd] of filhos) fila.push([p, nd]);
  }
  return null;
}
// Acha uma pasta de dados pelo NOME dela. Tenta os caminhos diretos (rápido) e só então varre.
const _pastaCache = new Map();
function acharPastaNoOneDrive(nomePasta, valida) {
  const c = _pastaCache.get(nomePasta);
  if (c && Date.now() - c.t < 5 * 60 * 1000 && (c.v === null || fs.existsSync(c.v))) return c.v;
  let achado = null;
  const roots = oneDriveRoots();
  // 1) tentativas diretas: raiz + (nome variável da biblioteca) + sufixos progressivos
  const sufixos = [
    path.join('002. ACCIONA', '001. BLOCO 02', '_APOIO', nomePasta),
    path.join('001. BLOCO 02', '_APOIO', nomePasta),                             // sync a partir de 002. ACCIONA
    path.join('_APOIO', nomePasta),                                              // sync a partir de 001. BLOCO 02
    nomePasta,                                                                   // sync a partir do _APOIO
  ];
  for (const root of roots) {
    const bases = [root];
    try { for (const n of fs.readdirSync(root)) bases.push(path.join(root, n)); } catch {}
    for (const b of bases) { for (const s of sufixos) {
      const p = path.join(b, s);
      try { if (fs.existsSync(p) && valida(p)) { achado = p; break; } } catch {}
    } if (achado) break; }
    if (achado) break;
  }
  // 2) último recurso: varredura guiada
  if (!achado) for (const root of roots) { achado = buscarPasta(root, nomePasta, valida); if (achado) break; }
  _pastaCache.set(nomePasta, { v: achado, t: Date.now() });
  return achado;
}
function oneDriveDadosDir() { return acharPastaNoOneDrive(DADOS_DIRNAME, ehPastaDados); }
// 2ª pasta oficial (decisão do Lucas 20/07): "_APOIO\ORÇAMENTO EEE" CONVIVE com a
// NEXUS-DADOS — as duas ficam separadas e o app procura nas duas.
const ORC_EEE_DIRNAME = 'ORÇAMENTO EEE';
const ehPastaOrcEee = p => {
  try { return ORC_EEE_SUBS.some(s => fs.existsSync(path.join(p, s))); } catch { return false; }
};
function oneDriveOrcEeeDir() { return acharPastaNoOneDrive(ORC_EEE_DIRNAME, ehPastaOrcEee); }
// TODAS as bases de dados que EXISTEM (OneDrive → servidor). NUNCA cria pasta vazia na
// LEITURA (bug 2.84.88). Override manual: env NEXUS_DADOS_DIR (aponta direto p/ a pasta).
function nexusDadosBases() {
  const bases = [];
  const add = p => { if (p && !bases.includes(p)) bases.push(p); };
  if (process.env.NEXUS_DADOS_DIR && fs.existsSync(process.env.NEXUS_DADOS_DIR)) add(process.env.NEXUS_DADOS_DIR);
  add(oneDriveDadosDir());        // _APOIO\NEXUS-DADOS   (base do app)
  add(oneDriveOrcEeeDir());       // _APOIO\ORÇAMENTO EEE (a do Lucas — as duas valem)
  if (process.env.NEXUS_ORC_EEE_DIR && fs.existsSync(process.env.NEXUS_ORC_EEE_DIR)) add(process.env.NEXUS_ORC_EEE_DIR);
  try { fs.accessSync(NEXUS_DADOS_SERVER_LEGACY, fs.constants.R_OK); add(NEXUS_DADOS_SERVER_LEGACY); } catch {}
  return bases;
}
// Cada "sub" que o app pede tem apelidos, porque a ORÇAMENTO EEE guarda as mesmas coisas
// com outros nomes de pasta (as análises ficam em NEXUS\ e _UPDATE_NEXUS\, etc.).
const SUB_APELIDOS = {
  'NEXUS-ANALISES':     ['NEXUS-ANALISES', 'NEXUS', '_UPDATE_NEXUS'],
  'COTACOES NEXUS':     ['COTACOES NEXUS', 'COTAÇÕES', 'COTACOES'],
  'FORNECEDORES NEXUS': ['FORNECEDORES NEXUS', 'FORNECEDORES'],
};
// base preferida p/ ESCRITA: override → OneDrive (acha ou cria no canônico) → servidor.
function nexusDadosWriteBase() {
  if (process.env.NEXUS_DADOS_DIR) { try { fs.mkdirSync(process.env.NEXUS_DADOS_DIR, { recursive: true }); return process.env.NEXUS_DADOS_DIR; } catch {} }
  const od = oneDriveDadosDir();
  if (od) return od;
  const root = oneDrive2SRoot();
  if (root) { const p = path.join(root, '001. SERVIDOR PARANÁ', NEXUS_DADOS_TAIL); try { fs.mkdirSync(p, { recursive: true }); return p; } catch {} }
  try { fs.accessSync(NEXUS_DADOS_SERVER_LEGACY, fs.constants.W_OK); return NEXUS_DADOS_SERVER_LEGACY; } catch {}
  return null;
}
// leitura: todas as fontes × todos os apelidos da subpasta (só o que existe de verdade)
//
// `posCache` diz ONDE entra o espelho do Supabase, e isso NÃO é detalhe: os leitores
// têm precedências OPOSTAS.
//   'fim'    → p/ quem usa o PRIMEIRO que achar (analises-list/load, precosCatalogoPath):
//              o cache fica com a MENOR prioridade, só completa o que falta.
//   'inicio' → p/ quem MESCLA sobrescrevendo (cotacoesLoad/fornecedoresLoad fazem
//              map.set(id) → o ÚLTIMO vence): o cache tem que vir ANTES pra pasta
//              local sobrescrever ele, senão um cache velho (o sync roda 2x/dia)
//              apagaria uma cotação recém-editada.
//   'nao'    → sem cache.
function dadosReadDirs(sub, posCache = 'fim') {
  const nomes = SUB_APELIDOS[sub] || [sub];
  const dirs = [];
  const push = p => { try { if (fs.existsSync(p) && !dirs.includes(p)) dirs.push(p); } catch {} };
  for (const b of nexusDadosBases()) for (const n of nomes) push(path.join(b, n));

  if (posCache === 'nao') return dirs;
  let cache = null;
  try { const c = path.join(nexusDadosCacheDir(), sub); if (fs.existsSync(c)) cache = c; } catch {}
  if (!cache || dirs.includes(cache)) return dirs;
  return posCache === 'inicio' ? [cache, ...dirs] : [...dirs, cache];
}
function dadosWriteDir(sub) { const b = nexusDadosWriteBase(); return b ? path.join(b, sub) : null; } // escrita: a preferida

// ── ESPELHO DO SUPABASE (tabela nexus_dados) ─────────────────────────────────
// Quem não tem a biblioteca do SharePoint sincronizada (ex.: Gustavo) ficava com
// lista VAZIA. O agente `scripts/nexus-dados-sync/sync.js` sobe os JSONs pro banco;
// aqui a gente baixa pra um cache LOCAL e registra esse cache como mais uma base.
// Assim TODO o código de leitura (dadosReadDirs/cotacoesLoad/analises-list/...) passa
// a enxergar os dados sem precisar mudar — e continua funcionando offline.
// O cache entra por ÚLTIMO: pasta local/servidor tem prioridade (é onde se escreve).
function nexusDadosCacheDir() { return path.join(app.getPath('userData'), 'nexus-dados-cache'); }
function _cacheManifestPath() { return path.join(nexusDadosCacheDir(), '_manifest.json'); }
function _cacheManifest() {
  try { return JSON.parse(fs.readFileSync(_cacheManifestPath(), 'utf8')) || {}; } catch { return {}; }
}
const DADOS_SUBS_CANON = ['NEXUS-ANALISES', 'COTACOES NEXUS', 'FORNECEDORES NEXUS'];

// Baixa o que mudou (compara sha256 do banco com o manifesto local). Silencioso:
// sem rede / sem tabela / anon sem permissão → mantém o cache que já existe.
async function atualizarCacheDadosSupabase() {
  try {
    const { data, error } = await supabase
      .from('nexus_dados')
      .select('pasta,nome,conteudo,sha256');
    if (error) { logUpdate('nexus-dados cache: ' + error.message); return { ok: false, erro: error.message }; }
    if (!Array.isArray(data)) return { ok: false, erro: 'resposta inesperada' };

    const base = nexusDadosCacheDir();
    const man = _cacheManifest();
    let gravados = 0, iguais = 0;
    for (const r of data) {
      if (!r || !r.pasta || !r.nome) continue;
      if (!DADOS_SUBS_CANON.includes(r.pasta)) continue;          // só as 3 conhecidas
      const nome = path.basename(String(r.nome));                  // nunca sair da pasta
      if (!/\.json$/i.test(nome)) continue;
      const chave = r.pasta + '|' + nome;
      const dir = path.join(base, r.pasta);
      const alvo = path.join(dir, nome);
      if (man[chave] && man[chave] === r.sha256 && fs.existsSync(alvo)) { iguais++; continue; }
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(alvo, JSON.stringify(r.conteudo, null, 2), 'utf8');
        man[chave] = r.sha256;
        gravados++;
      } catch (e) { logUpdate('nexus-dados cache write ' + chave + ': ' + e.message); }
    }
    try {
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(_cacheManifestPath(), JSON.stringify(man, null, 1), 'utf8');
    } catch {}
    logUpdate(`nexus-dados cache: ${data.length} no banco, ${gravados} atualizados, ${iguais} iguais`);
    return { ok: true, total: data.length, gravados, iguais };
  } catch (e) {
    logUpdate('nexus-dados cache exception: ' + e.message);
    return { ok: false, erro: e.message };
  }
}
ipcMain.handle('nexus-dados:atualizar-cache', async () => atualizarCacheDadosSupabase());

function cotacoesServerPath() {
  const d = dadosWriteDir('COTACOES NEXUS');
  if (!d) return null;
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return path.join(d, 'cotacoes.json'); }
  catch { return null; }
}
function cotacoesLocalPath() { return path.join(app.getPath('userData'), 'cotacoes-eee.json'); }
function cotacoesReadFrom(p) {
  try { if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || []; } catch {}
  return [];
}
function cotacoesLoad() {
  const map = new Map();
  // 'inicio': mescla por id sobrescrevendo → a pasta local tem que vir DEPOIS do cache
  const fontes = [...dadosReadDirs('COTACOES NEXUS', 'inicio').map(d => path.join(d, 'cotacoes.json')), cotacoesLocalPath()];
  for (const p of fontes) for (const c of cotacoesReadFrom(p)) if (c && c.id) map.set(c.id, c);
  return Array.from(map.values()).sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
}
function cotacoesSave(arr) {
  const s = cotacoesServerPath();
  const p = s || cotacoesLocalPath();
  fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf8');
  return { onServer: !!s, path: p };
}

// ── FORNECEDORES (contatos) — base COMPARTILHADA; qualquer um adiciona/vê ──
// Mesmo padrão das cotações: arquivo único no servidor + fallback local (merge por id).
function fornecedoresServerPath() {
  const d = dadosWriteDir('FORNECEDORES NEXUS');
  if (!d) return null;
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return path.join(d, 'fornecedores.json'); }
  catch { return null; }
}
function fornecedoresLocalPath() { return path.join(app.getPath('userData'), 'fornecedores-eee.json'); }
function fornecedoresReadFrom(p) {
  try { if (p && fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) || []; } catch {}
  return [];
}
function fornecedoresLoad() {
  const map = new Map();
  // 'inicio': mesmo motivo das cotações — o último da lista vence na mesclagem
  const fontes = [...dadosReadDirs('FORNECEDORES NEXUS', 'inicio').map(d => path.join(d, 'fornecedores.json')), fornecedoresLocalPath()];
  for (const p of fontes) for (const c of fornecedoresReadFrom(p)) if (c && c.id) map.set(c.id, c);
  return Array.from(map.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}
function fornecedoresSave(arr) {
  const s = fornecedoresServerPath();
  const p = s || fornecedoresLocalPath();
  fs.writeFileSync(p, JSON.stringify(arr, null, 2), 'utf8');
  return { onServer: !!s, path: p };
}
ipcMain.handle('orc-elev:fornecedores-list', async () => {
  try { const s = fornecedoresServerPath(); return { ok: true, fornecedores: fornecedoresLoad(), onServer: !!s, path: s || fornecedoresLocalPath() }; }
  catch (e) { return { ok: false, erro: e.message, fornecedores: [] }; }
});
ipcMain.handle('orc-elev:fornecedores-add', async (_e, f) => {
  try {
    const now = new Date();
    const rec = {
      id: String(now.getTime()) + '-' + Math.random().toString(36).slice(2, 7),
      nome: String((f && f.nome) || '').trim(),
      telefone: String((f && f.telefone) || '').trim(),
      email: String((f && f.email) || '').trim(),
      fornece: String((f && f.fornece) || '').trim(),
      homologado: String((f && f.homologado) || '').trim(),  // 'sim' | 'nao' | '' (a verificar)
      criadoPor: String((f && f.criadoPor) || '').trim(),
      criadoEm: now.toISOString(),
    };
    if (!rec.nome) return { ok: false, erro: 'Nome do fornecedor é obrigatório.' };
    const arr = fornecedoresLoad(); arr.push(rec);
    const info = fornecedoresSave(arr);
    return { ok: true, fornecedores: fornecedoresLoad(), ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('orc-elev:fornecedores-del', async (_e, id) => {
  try {
    const rest = fornecedoresLoad().filter(c => c.id !== id);
    const info = fornecedoresSave(rest);
    return { ok: true, fornecedores: rest, ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('orc-elev:fornecedores-update', async (_e, id, f) => {
  try {
    const arr = fornecedoresLoad();
    const idx = arr.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, erro: 'fornecedor não encontrado' };
    const cur = arr[idx];
    const upd = {
      ...cur,
      nome: String((f && f.nome != null ? f.nome : cur.nome) || '').trim(),
      telefone: String((f && f.telefone != null ? f.telefone : cur.telefone) || '').trim(),
      email: String((f && f.email != null ? f.email : cur.email) || '').trim(),
      fornece: String((f && f.fornece != null ? f.fornece : cur.fornece) || '').trim(),
      homologado: String((f && f.homologado != null ? f.homologado : cur.homologado) || '').trim(),
      editadoEm: new Date().toISOString(),
    };
    if (!upd.nome) return { ok: false, erro: 'Nome é obrigatório.' };
    arr[idx] = upd;
    const info = fornecedoresSave(arr);
    return { ok: true, fornecedores: fornecedoresLoad(), ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
// Abre link externo (WhatsApp/e-mail) no app/navegador padrão. Só http(s)/mailto/tel.
ipcMain.handle('orc-elev:open-external', async (_e, url) => {
  try {
    if (typeof url === 'string' && /^(https?:|mailto:|tel:)/i.test(url)) { await shell.openExternal(url); return { ok: true }; }
    return { ok: false, erro: 'link inválido' };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('orc-elev:cotacoes-list', async () => {
  try { const s = cotacoesServerPath(); return { ok: true, cotacoes: cotacoesLoad(), onServer: !!s, path: s || cotacoesLocalPath() }; }
  catch (e) { return { ok: false, erro: e.message, cotacoes: [] }; }
});
ipcMain.handle('orc-elev:cotacoes-add', async (_e, cot) => {
  try {
    const now = new Date();
    const rec = {
      id: String(now.getTime()) + '-' + Math.random().toString(36).slice(2, 7),
      item: String((cot && cot.item) || '').trim(),
      unidade: String((cot && cot.unidade) || '').trim(),
      preco: Number(cot && cot.preco) || 0,
      fornecedor: String((cot && cot.fornecedor) || '').trim(),
      data: String((cot && cot.data) || '').trim(),
      codigo: String((cot && cot.codigo) || '').trim(),
      obs: String((cot && cot.obs) || '').trim(),
      criadoPor: String((cot && cot.criadoPor) || '').trim(),
      criadoEm: now.toISOString(),
    };
    if (!rec.item) return { ok: false, erro: 'Descrição do item é obrigatória.' };
    const arr = cotacoesLoad(); arr.unshift(rec);
    const info = cotacoesSave(arr);
    return { ok: true, cotacoes: arr, ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
// Anexa um DOCUMENTO de cotação (PDF do fornecedor, com vários itens). Copia o
// arquivo p/ a pasta docs\ do banco (servidor, fallback local) e registra o
// metadado. Os VALORES não são digitados — o documento fica guardado p/ o Claude
// ler e entender os itens/preços na hora de montar o orçamento.
ipcMain.handle('orc-elev:cotacoes-add-doc', async (_e, meta) => {
  try {
    const src = String((meta && meta.arquivo) || '').trim();
    if (!src || !fs.existsSync(src)) return { ok: false, erro: 'Selecione o arquivo PDF da cotação.' };
    const now = new Date();
    const id = String(now.getTime()) + '-' + Math.random().toString(36).slice(2, 7);
    const s = cotacoesServerPath();
    const baseDir = s ? path.dirname(s) : path.dirname(cotacoesLocalPath());
    const docsDir = path.join(baseDir, 'docs');
    try { if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true }); } catch {}
    const nomeOrig = path.basename(src);
    const destName = id + '__' + nomeOrig.replace(/[^\w.\-() ]+/g, '_');
    const dest = path.join(docsDir, destName);
    let arquivoFinal = src, copiado = false;
    try { fs.copyFileSync(src, dest); arquivoFinal = dest; copiado = true; } catch {}
    const rec = {
      id, tipo: 'doc',
      assunto: String((meta && meta.assunto) || '').trim(),
      fornecedor: String((meta && meta.fornecedor) || '').trim(),
      data: String((meta && meta.data) || '').trim(),
      arquivo: arquivoFinal,
      nomeOriginal: nomeOrig,
      obs: String((meta && meta.obs) || '').trim(),
      criadoPor: String((meta && meta.criadoPor) || '').trim(),
      criadoEm: now.toISOString(),
    };
    const arr = cotacoesLoad(); arr.unshift(rec);
    const info = cotacoesSave(arr);
    return { ok: true, cotacoes: arr, copiado, ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
ipcMain.handle('orc-elev:cotacoes-del', async (_e, id) => {
  try {
    const arr = cotacoesLoad();
    const alvo = arr.find(c => c.id === id);
    if (alvo && alvo.tipo === 'doc' && alvo.arquivo) {
      try { if (alvo.arquivo.includes(path.sep + 'docs' + path.sep) && fs.existsSync(alvo.arquivo)) fs.unlinkSync(alvo.arquivo); } catch {}
    }
    const rest = arr.filter(c => c.id !== id);
    const info = cotacoesSave(rest);
    return { ok: true, cotacoes: rest, ...info };
  } catch (e) { return { ok: false, erro: e.message }; }
});
// Abre o PDF de uma cotação (doc) no visualizador padrão.
ipcMain.handle('orc-elev:cotacoes-abrir', async (_e, id) => {
  try {
    const alvo = cotacoesLoad().find(c => c.id === id);
    if (!alvo || !alvo.arquivo) return { ok: false, erro: 'Cotação não encontrada.' };
    const r = await shell.openPath(alvo.arquivo);
    return { ok: !r, error: r || null };
  } catch (e) { return { ok: false, erro: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// ANÁLISE DE PROJETOS (Fase 2) — "inbox" de análises que o Claude produz.
// O Claude lê os projetos no chat, mapeia campo-a-campo (schema) e grava um
// JSON aqui; o Nexus lista e importa p/ pré-preencher o form (o usuário revisa).
// Formato do JSON: { obra, sb, cidade, contrato, data:{key:val}, cp:{key:[preco,fonte]}, meta:{...} }
// ────────────────────────────────────────────────────────────────────
ipcMain.handle('orc-elev:analises-list', async () => {
  try {
    const dirs = dadosReadDirs('NEXUS-ANALISES');           // OneDrive + servidor + cache do banco
    const locais = dadosReadDirs('NEXUS-ANALISES', 'nao');  // só pasta/servidor — p/ o flag onServer não mentir
    const byFile = new Map();                                // dedup por nome (1ª fonte = preferida)
    for (const dir of dirs) {
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => /\.json$/i.test(f)); } catch { continue; }
      for (const f of files) {
        if (byFile.has(f)) continue;
        const full = path.join(dir, f);
        let meta = {};
        try { const j = JSON.parse(fs.readFileSync(full, 'utf8')); meta = { obra: j.obra, sb: j.sb, cidade: j.cidade, ncampos: Object.keys(j.data || {}).length }; } catch {}
        let mtime = 0; try { mtime = fs.statSync(full).mtimeMs; } catch {}
        byFile.set(f, { file: f, ...meta, mtime });
      }
    }
    const analises = Array.from(byFile.values()).sort((a, b) => b.mtime - a.mtime);
    return { ok: true, analises, onServer: locais.length > 0, doBanco: dirs.length > locais.length };
  } catch (e) { return { ok: false, erro: e.message, analises: [] }; }
});
ipcMain.handle('orc-elev:analises-load', async (_e, file) => {
  try {
    const base = path.basename(String(file || ''));
    for (const dir of dadosReadDirs('NEXUS-ANALISES')) {
      const full = path.join(dir, base);
      if (fs.existsSync(full)) return { ok: true, analise: JSON.parse(fs.readFileSync(full, 'utf8')) };
    }
    return { ok: false, erro: 'Análise não encontrada.' };
  } catch (e) { return { ok: false, erro: e.message }; }
});
// Aplica o catálogo de preços de cotação (precos.json) por CIDADE/SB -> {key:[preço,fonte]}.
// Usado no Importar da análise p/ já trazer os preços CP (ex.: painel) preenchidos.
function precosCatalogoPath() {
  for (const d of dadosReadDirs('COTACOES NEXUS')) { const p = path.join(d, 'precos.json'); if (fs.existsSync(p)) return p; }
  return path.join(NEXUS_DADOS_SERVER_LEGACY, 'COTACOES NEXUS', 'precos.json');
}
function _normTxt(s) { return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim(); }
ipcMain.handle('orc-elev:catalogo-aplicar', async (_e, ctx) => {
  try {
    const cat = JSON.parse(fs.readFileSync(precosCatalogoPath(), 'utf8'));
    const itens = (cat && cat.itens) || {};
    const cidade = _normTxt(ctx && ctx.cidade);
    const sb = _normTxt(ctx && ctx.sb).replace(/^SB[-\s]*/, '');
    const out = {};
    for (const [key, info] of Object.entries(itens)) {
      let preco = null;
      const pc = (info && info.precos_por_cidade) || {};
      for (const [ch, val] of Object.entries(pc)) { const n = _normTxt(ch); if (n && cidade.includes(n)) { preco = val; break; } }
      if (preco == null) { const ps = (info && info.precos_por_sb) || {}; if (ps[sb] != null) preco = ps[sb]; }
      if (preco == null && info && info.preco_default != null) preco = info.preco_default;
      if (preco != null) out[key] = [Number(preco), (info && info.fonte) || 'cotação (banco)'];
    }
    return { ok: true, precos: out };
  } catch (e) { return { ok: false, erro: e.message, precos: {} }; }
});

// ────────────────────────────────────────────────────────────────────
// RH — BANCO DE CURRÍCULOS (índice local + busca por palavra-chave).
// Store em userData\curriculos (arquivos copiados + index.json). Extração
// de texto via scripts/rh/curriculos.py. Reusa orcRceResolvePython().
// ────────────────────────────────────────────────────────────────────
function rhCvScript() {
  const cands = [
    path.join(__dirname, '..', 'scripts', 'rh', 'curriculos.py'),
    path.join(process.resourcesPath || '', 'scripts', 'rh', 'curriculos.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'rh', 'curriculos.py'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return null;
}
function rhCvStore() { return path.join(app.getPath('userData'), 'curriculos'); }
async function rhCvRun(cfg) {
  const script = rhCvScript();
  if (!script) return { ok: false, erro: 'Script curriculos.py não encontrado.' };
  const py = orcRceResolvePython();
  if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };
  cfg.store = rhCvStore();
  const tmpJson = path.join(os.tmpdir(), `nexus_rh_cv_${Date.now()}.json`);
  fs.writeFileSync(tmpJson, JSON.stringify(cfg), 'utf8');
  const { spawn } = require('child_process');
  const args = [...py.args, script, '--config', tmpJson];
  return await new Promise((resolve) => {
    let out = '', err = '';
    let proc;
    try { proc = spawn(py.cmd, args, { windowsHide: true }); }
    catch (e) { try { fs.unlinkSync(tmpJson); } catch {} return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message }); }
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', (e) => { try { fs.unlinkSync(tmpJson); } catch {} resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message }); });
    proc.on('close', (code) => {
      try { fs.unlinkSync(tmpJson); } catch {}
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i--) { try { parsed = JSON.parse(lines[i]); break; } catch {} }
      resolve(parsed && typeof parsed === 'object' ? parsed : { ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1200) });
    });
  });
}
ipcMain.handle('rh-cv:importar-pasta', async () => {
  if (!mainWindow) return { ok: false, erro: 'sem janela' };
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Escolher pasta de currículos (importa tudo, inclusive subpastas)', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, cancelado: true };
  return await rhCvRun({ op: 'importar', paths: [r.filePaths[0]], raiz: r.filePaths[0] });
});
ipcMain.handle('rh-cv:adicionar-arquivos', async () => {
  if (!mainWindow) return { ok: false, erro: 'sem janela' };
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Adicionar currículos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Currículos', extensions: ['pdf', 'docx', 'doc', 'odt', 'txt', 'rtf'] }, { name: 'Todos', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths.length) return { ok: false, cancelado: true };
  return await rhCvRun({ op: 'importar', paths: r.filePaths });
});
ipcMain.handle('rh-cv:buscar', async (_e, p) => {
  if (typeof p === 'string') p = { query: p };
  p = p || {};
  return rhCvRun({ op: 'buscar', query: p.query || '', filtros: p.filtros || {} });
});
ipcMain.handle('rh-cv:reindex', async () => rhCvRun({ op: 'reindex' }));
ipcMain.handle('rh-cv:excluir', async (_e, ids) => rhCvRun({ op: 'excluir', ids: ids || [] }));
ipcMain.handle('rh-cv:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// MEMORIAL DESCRITIVO RCE — gera o .docx do Memorial Descritivo chamando o
// gerador Python (scripts/memorial/gerar_memorial_descritivo.py), dirigido por
// um JSON de configuracao com caminhos do projeto + dados + fluxograma.
// Padrao isolado: handlers com prefixo "memorial:". Reusa o resolvedor de
// Python do RCE (orcRceResolvePython).
// ────────────────────────────────────────────────────────────────────
function memorialResolveScript() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'memorial', 'gerar_memorial_descritivo.py'),
    path.join(process.resourcesPath || '', 'scripts', 'memorial', 'gerar_memorial_descritivo.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'memorial', 'gerar_memorial_descritivo.py'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

ipcMain.handle('memorial:pick-file', async (_e, kind) => {
  if (!mainWindow) return null;
  const filtros = {
    ose:           [{ name: 'Excel', extensions: ['xlsx'] }],
    modelo:        [{ name: 'Modelo SewerGEMS', extensions: ['sqlite', 'stsw', 'db'] }],
    interferencias:[{ name: 'Shapefile', extensions: ['shp'] }],
    soleiras:      [{ name: 'Shapefile / ZIP', extensions: ['shp', 'zip'] }],
    template:      [{ name: 'Word', extensions: ['docx'] }],
    dados_json:    [{ name: 'JSON', extensions: ['json'] }],
  };
  // OSE aceita varias planilhas (mescladas no memorial); demais sao 1 arquivo.
  const multi = (kind === 'ose');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: multi ? 'Selecionar arquivo(s)' : 'Selecionar arquivo',
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: (filtros[kind] || []).concat([{ name: 'Todos os arquivos', extensions: ['*'] }]),
  });
  if (result.canceled) return null;
  return multi ? result.filePaths : result.filePaths[0];
});

ipcMain.handle('memorial:pick-dir', async (_e, _kind) => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar pasta',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('memorial:pick-save', async (_e, defaultName) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar Memorial Descritivo',
    defaultPath: defaultName || 'Memorial_Descritivo.docx',
    filters: [{ name: 'Word', extensions: ['docx'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('memorial:gerar', async (_e, cfg) => {
  try {
    cfg = cfg || {};
    if (!cfg.saida) return { ok: false, erro: 'Caminho de saída não informado.' };

    const script = memorialResolveScript();
    if (!script) return { ok: false, erro: 'Gerador Python não encontrado (scripts/memorial/gerar_memorial_descritivo.py).' };

    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    // grava config.json num tmp
    const tmpJson = path.join(os.tmpdir(), `nexus_memorial_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(cfg, null, 2), 'utf8');

    const { spawn } = require('child_process');
    const args = [...py.args, script, '--config', tmpJson];

    return await new Promise((resolve) => {
      let out = '', err = '';
      let proc;
      try {
        // cwd = pasta do script p/ os imports (gerar_fluxograma, mapa*) resolverem
        proc = spawn(py.cmd, args, { windowsHide: true, cwd: path.dirname(script) });
      } catch (e) {
        try { fs.unlinkSync(tmpJson); } catch {}
        return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message });
      }
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => err += d.toString());
      proc.on('error', (e) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message });
      });
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        // última linha não-vazia do stdout = JSON
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try { parsed = JSON.parse(lines[i]); break; } catch {}
        }
        if (parsed && typeof parsed === 'object') {
          resolve(parsed);
        } else {
          resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1500) });
        }
      });
    });
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('memorial:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// MAPA GERAL — do Excel FlexTable (SewerGEMS) gera SHAPE (PV c/ cotas +
// REDES) + DXF geral (blocos SES-POÇO-DE-VISITA/SES-TL + MLEADER com
// anti-colisão portado do AJUSTARTEXTOPV + rótulos de rede estilo
// ROTULARALINHAMENTOS). Gerador Python scripts/mapa-geral/gerar_mapa.py,
// dirigido por config.json. Reusa o resolvedor de Python do RCE.
// ────────────────────────────────────────────────────────────────────
function mapaResolveScript() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'mapa-geral', 'gerar_mapa.py'),
    path.join(process.resourcesPath || '', 'scripts', 'mapa-geral', 'gerar_mapa.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'mapa-geral', 'gerar_mapa.py'),
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}

ipcMain.handle('mapa:pick-excel', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar Excel FlexTable (SewerGEMS)',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx'] }, { name: 'Todos', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('mapa:pick-dir', async (_e, titulo) => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: titulo || 'Selecionar pasta', properties: ['openDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('mapa:gerar', async (_e, cfg) => {
  try {
    cfg = cfg || {};
    if (!cfg.excel)    return { ok: false, erro: 'Excel não informado.' };
    if (!cfg.saidaDir) return { ok: false, erro: 'Pasta de saída não informada.' };

    const script = mapaResolveScript();
    if (!script) return { ok: false, erro: 'Gerador Python não encontrado (scripts/mapa-geral/gerar_mapa.py).' };
    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    const tmpJson = path.join(os.tmpdir(), `nexus_mapa_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(cfg, null, 2), 'utf8');

    const { spawn } = require('child_process');
    const args = [...py.args, script, '--config', tmpJson];
    return await new Promise((resolve) => {
      let out = '', err = '';
      let proc;
      try {
        proc = spawn(py.cmd, args, { windowsHide: true, cwd: path.dirname(script),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      } catch (e) {
        try { fs.unlinkSync(tmpJson); } catch {}
        return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message });
      }
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => err += d.toString());
      proc.on('error', (e) => { try { fs.unlinkSync(tmpJson); } catch {} resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message }); });
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) { try { parsed = JSON.parse(lines[i]); break; } catch {} }
        if (parsed && typeof parsed === 'object') resolve(parsed);
        else resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1500) });
      });
    });
  } catch (e) { return { ok: false, erro: e.message }; }
});

ipcMain.handle('mapa:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// MONOGRAFIA DE MARCO TOPOGRÁFICO — gera o .docx (padrão 2S/ACCIONA/SANEPAR)
// a partir do PDF do PPP-IBGE (+ fotos opcionais), chamando o pipeline Python
// em ~/jarvis/gerar_monografia.py (parser PPP → geocoding → mapa → DOCX).
// Reusa o resolvedor de Python do RCE (orcRceResolvePython). As linhas de
// progresso ([1/5]…) sobem por 'monografia:progresso'; a última linha = JSON.
// ────────────────────────────────────────────────────────────────────
ipcMain.handle('monografia:gerar', async (event, params) => {
  try {
    params = params || {};
    if (!params.pdfPath || !fs.existsSync(params.pdfPath))
      return { ok: false, erro: 'PDF do PPP-IBGE inválido ou não encontrado.' };
    const script = path.join(os.homedir(), 'jarvis', 'gerar_monografia.py');
    if (!fs.existsSync(script))
      return { ok: false, erro: 'Gerador não encontrado: ' + script };
    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    const args = [...py.args, script, params.pdfPath];
    if (params.foto1) args.push('--foto1', params.foto1);
    if (params.foto2) args.push('--foto2', params.foto2);
    if (params.fotosPath) args.push('--fotos', params.fotosPath);
    if (params.marco) args.push('--marco', params.marco);
    if (params.basemap) args.push('--basemap', params.basemap);
    const opt = {
      '--responsavel': params.responsavel, '--rev': params.rev,
      '--contrato': params.contrato, '--material': params.material,
      '--equipamento': params.equipamento,
    };
    for (const [k, v] of Object.entries(opt)) if (v) args.push(k, String(v));

    const { spawn } = require('child_process');
    const send = (m) => { try { event.sender.send('monografia:progresso', m); } catch {} };

    return await new Promise((resolve) => {
      let out = '', err = '', proc;
      try {
        proc = spawn(py.cmd, args, {
          windowsHide: true, cwd: path.dirname(script),
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        });
      } catch (e) { return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message }); }
      proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
      proc.stdout.on('data', d => { out += d; d.split(/\r?\n/).forEach(l => { l = l.trim(); if (l && l[0] !== '{') send(l); }); });
      proc.stderr.on('data', d => { err += d; d.split(/\r?\n/).forEach(l => { l = l.trim(); if (l) send('⚠ ' + l); }); });
      proc.on('error', (e) => resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message }));
      proc.on('close', (code) => {
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) { try { parsed = JSON.parse(lines[i]); break; } catch {} }
        if (parsed && typeof parsed === 'object') resolve(parsed);
        else resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1500) });
      });
    });
  } catch (e) { return { ok: false, erro: e.message }; }
});

ipcMain.handle('monografia:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// ────────────────────────────────────────────────────────────────────
// ABAS EXCEL → PDF — exporta cada aba de uma planilha (.xlsx) como um PDF
// separado (nome do PDF = nome da aba), chamando o motor Python
// (scripts/orcamento/excel_abas_para_pdf.py) via Excel COM. Padrão isolado:
// handlers com prefixo "abas-pdf:". Reusa o resolvedor de Python do RCE
// (ORC_RCE_PYTHON_CANDIDATES / orcRceResolvePython).
// ────────────────────────────────────────────────────────────────────

function abasPdfResolveScript() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'orcamento', 'excel_abas_para_pdf.py'),
    path.join(process.resourcesPath || '', 'scripts', 'orcamento', 'excel_abas_para_pdf.py'),
    path.join(app.getAppPath(), '..', 'scripts', 'orcamento', 'excel_abas_para_pdf.py'),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

ipcMain.handle('abas-pdf:select-xlsx', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar planilha (.xlsx)',
    properties: ['openFile'],
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('abas-pdf:pick-dir', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar pasta de destino dos PDFs',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('abas-pdf:gerar', async (_e, cfg) => {
  try {
    cfg = cfg || {};
    if (!cfg.planilha) return { ok: false, erro: 'Planilha (.xlsx) não informada.' };
    if (!cfg.destino)  return { ok: false, erro: 'Pasta de destino não informada.' };

    const script = abasPdfResolveScript();
    if (!script) return { ok: false, erro: 'Motor Python não encontrado (scripts/orcamento/excel_abas_para_pdf.py).' };

    const py = orcRceResolvePython();
    if (!py) return { ok: false, erro: 'Python não encontrado. Instale o Python 3 ou defina NEXUS_PYTHON.' };

    const tmpJson = path.join(os.tmpdir(), `nexus_abas_pdf_${Date.now()}.json`);
    fs.writeFileSync(tmpJson, JSON.stringify(cfg, null, 2), 'utf8');

    const { spawn } = require('child_process');
    const args = [...py.args, script, '--config', tmpJson];

    return await new Promise((resolve) => {
      let out = '', err = '';
      let proc;
      try {
        proc = spawn(py.cmd, args, { windowsHide: true });
      } catch (e) {
        try { fs.unlinkSync(tmpJson); } catch {}
        return resolve({ ok: false, erro: 'Falha ao iniciar o Python: ' + e.message });
      }
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => err += d.toString());
      proc.on('error', (e) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        resolve({ ok: false, erro: 'Erro ao executar o Python: ' + e.message });
      });
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson); } catch {}
        const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        let parsed = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          try { parsed = JSON.parse(lines[i]); break; } catch {}
        }
        if (parsed && typeof parsed === 'object') {
          resolve(parsed);
        } else {
          resolve({ ok: false, erro: (err || out || `Python saiu com código ${code} sem JSON.`).slice(-1200) });
        }
      });
    });
  } catch (e) {
    return { ok: false, erro: e.message };
  }
});

ipcMain.handle('abas-pdf:abrir', async (_e, p) => {
  try { const r = await shell.openPath(p); return { ok: !r, error: r || null }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// Auto-install/refresh no startup do Nexus. Roda silencioso; falhas (Civil
// 3D aberto, etc) ficam no log e podem ser tentadas de novo via UI.
function c3dAutoInstallBundleOnStartup() {
  try {
    // SEMPRE garante o TrustedPaths ANTES de qualquer coisa — é o que evita o
    // diálogo SECURELOAD ("Unsigned Executable") do AutoCAD travar o CAD na
    // primeira carga. Roda sempre (idempotente), independente do install dar
    // skip/erro, porque um profile de CAD novo pode ter surgido desde a última
    // vez. O bundle fica em pasta gravável (%APPDATA%) → o AutoCAD não confia
    // sozinho; só carrega sem prompt se o caminho estiver no TrustedPaths.
    try { c3dEnsureTrustedPath(); } catch {}
    // Registra tb o auto-loader nativo (chave Applications) — o PackageContents
    // do bundle NÃO auto-carrega no Civil 3D 2027; esta chave garante a carga.
    try { c3dEnsureAppLoader(); } catch {}

    // Sempre chama c3dInstallBundleSync — ele compara byte-a-byte e faz skip se
    // a DLL no bundle já é idêntica. Comparar só pela versão deixa passar
    // updates onde a versão "bate" mas a DLL embedded mudou (ex: hot-fix).
    const r = c3dInstallBundleSync();
    if (r.ok) {
      logUpdate(`civil3d:bundle: auto-install ok v${r.version}`);
      _c3dNeedsCadRestart = false;
      try { c3dEnsureTrustedPath(); } catch {}
      try { c3dEnsureAppLoader(); } catch {}
    }
    else if (r.restartCad) {
      logUpdate('civil3d:bundle: skip (CAD aberto) — bundle stale, flagged needs-cad-restart');
      _c3dNeedsCadRestart = true;
      // Emite pra janelas já abertas; também temos hook em browser-window-created
      // pra pegar janelas que ainda vão subir.
      _c3dEmitNeedsCadRestartToAllWindows();
    }
    else logUpdate('civil3d:bundle: auto-install falhou: ' + (r.error || ''));
  } catch (e) {
    logUpdate('civil3d:bundle: auto-install exception: ' + e.message);
  }
}

// Quando qualquer janela termina de carregar, se a flag estiver ativa, manda o
// aviso. Cobre o caso do auto-install rodar antes do mainWindow existir.
app.on('browser-window-created', (_e, win) => {
  try {
    win.webContents.on('did-finish-load', () => {
      if (_c3dNeedsCadRestart) {
        try { win.webContents.send('civil3d:bundle:needs-cad-restart'); } catch {}
      }
    });
  } catch {}
});

// Adiciona o path do bundle ao TRUSTEDPATHS do Civil 3D (2026 E 2027) via
// registro, pra DLL carregar sem o prompt SECURELOAD ("DLL não confiável...").
// O TRUSTEDPATHS fica em (a chave de versão muda por release):
//   HKCU\Software\Autodesk\AutoCAD\<R25.1|R26.0>\<ProductKey>\Profiles\<Profile>\General
//   ValueName: TrustedPaths (REG_SZ, paths separados por ;)
// Cada versão registra a SUA pasta no seu próprio ramo do registro.
function c3dEnsureTrustedPath() {
  for (const t of C3D_TARGETS) {
    const trustedDir = c3dBundleDllDir(t.ver);
    if (!fs.existsSync(trustedDir)) continue;          // só registra versão instalada
    const regVer = t.seriesMin;                        // 'R25.1' / 'R26.0' = chave do registro
    try {
      const { execSync } = require('child_process');
      // PowerShell que percorre todos os profiles daquela versão e garante o path.
      // Idempotente: se path já está presente, não duplica. Emite um marcador
      // NO_BRANCH/OK:<n>/NO_PROFILES pra o Node logar — é o que revela, no log do
      // usuário, quando o ramo R26.0 (Civil 2027) ainda não existe (causa nº1 do
      // SECURELOAD travar o 2027: o Civil 2027 nunca foi aberto p/ criar o profile).
      const ps = `
$ErrorActionPreference = 'SilentlyContinue';
$bundlePath = '${trustedDir.replace(/'/g, "''")}';
$baseRegPath = 'HKCU:\\Software\\Autodesk\\AutoCAD\\${regVer}';
if (-not (Test-Path $baseRegPath)) { Write-Output 'NO_BRANCH'; exit 0; }
$n = 0;
Get-ChildItem $baseRegPath -ErrorAction SilentlyContinue | ForEach-Object {
  $productKey = $_.PSChildName;
  $profilesPath = "$baseRegPath\\$productKey\\Profiles";
  if (-not (Test-Path $profilesPath)) { return; }

  Get-ChildItem $profilesPath -ErrorAction SilentlyContinue | ForEach-Object {
    $profile = $_.PSChildName;
    $generalPath = "$profilesPath\\$profile\\General";
    if (-not (Test-Path $generalPath)) {
      New-Item -Path $generalPath -Force | Out-Null;
    }
    $current = (Get-ItemProperty -Path $generalPath -Name 'TrustedPaths' -ErrorAction SilentlyContinue).TrustedPaths;
    if (-not $current) { $current = ''; }
    $parts = $current -split ';' | Where-Object { $_ -and $_.Trim() };
    if ($parts -notcontains $bundlePath) {
      $newValue = if ($current) { "$current;$bundlePath" } else { $bundlePath };
      Set-ItemProperty -Path $generalPath -Name 'TrustedPaths' -Value $newValue -Type String -Force;
    }
    $n++;
  };
};
if ($n -eq 0) { Write-Output 'NO_PROFILES'; } else { Write-Output ('OK:' + $n); }
exit 0;
`.trim();

      const out = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
        windowsHide: true,
        timeout: 8000,
        encoding: 'utf8',
      }).trim();
      if (out === 'NO_BRANCH')
        logUpdate(`civil3d:bundle: TrustedPaths (${t.ver}/${regVer}) PULADO — Civil ${t.ver} nunca foi aberto (ramo do registro ${regVer} inexistente). Abra o Civil ${t.ver} 1x e reabra o Nexus.`);
      else if (out === 'NO_PROFILES')
        logUpdate(`civil3d:bundle: TrustedPaths (${t.ver}/${regVer}) sem profiles no registro — SECURELOAD pode pedir confirmação na 1ª carga.`);
      else
        logUpdate(`civil3d:bundle: TrustedPaths (${t.ver}/${regVer}) OK em ${out.replace('OK:', '')} profile(s): ${trustedDir}`);
    } catch (e) {
      logUpdate(`civil3d:bundle: TrustedPaths (${t.ver}) falhou: ` + e.message);
    }
  }
}

// Registra a DLL do bundle no AUTO-LOADER NATIVO do AutoCAD (chave "Applications"
// do registro), por versão instalada. É o mecanismo confiável que NÃO depende do
// matching do PackageContents — necessário no Civil 3D 2027 (R26.0), onde o
// auto-load do bundle via PackageContents NÃO engata (a DLL nunca tenta carregar
// no startup; comprovado 09/07 na Katia/Camila). O LOADER aponta pro DLL DENTRO
// do bundle (que tem as dependências WebView2/Sentry ao lado) — carregar a cópia
// "pelada" de %APPDATA%\Nexus\plugins quebra o Initialize por falta das libs.
//   HKCU\Software\Autodesk\AutoCAD\<R25.1|R26.0>\<ProductKey>\Applications\Nexus<ver>
//   LOADER (REG_SZ) = <bundle>\Contents\Civil3D\<ver>\GerarProjetoMND.dll
//   MANAGED=1 (assembly .NET) · LOADCTRLS=2 (carrega no startup) · DESCRIPTION
function c3dEnsureAppLoader() {
  for (const t of C3D_TARGETS) {
    const dllPath = c3dBundleDllPath(t.ver);
    if (!fs.existsSync(dllPath)) continue;              // só registra versão instalada
    const regVer = t.seriesMin;                         // 'R25.1' / 'R26.0'
    try {
      const { execSync } = require('child_process');
      const ps = `
$ErrorActionPreference = 'SilentlyContinue';
$dll = '${dllPath.replace(/'/g, "''")}';
$appName = 'Nexus${t.ver}';
$baseRegPath = 'HKCU:\\Software\\Autodesk\\AutoCAD\\${regVer}';
if (-not (Test-Path $baseRegPath)) { Write-Output 'NO_BRANCH'; exit 0; }
$n = 0;
Get-ChildItem $baseRegPath -ErrorAction SilentlyContinue | ForEach-Object {
  $productKey = $_.PSChildName;
  $appsPath = "$baseRegPath\\$productKey\\Applications";
  if (-not (Test-Path $appsPath)) { New-Item -Path $appsPath -Force | Out-Null; }
  $key = "$appsPath\\$appName";
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null; }
  New-ItemProperty -Path $key -Name 'DESCRIPTION' -Value 'Nexus Civil 3D Plugin (A2Z)' -PropertyType String -Force | Out-Null;
  New-ItemProperty -Path $key -Name 'LOADCTRLS'   -Value 2   -PropertyType DWord  -Force | Out-Null;
  New-ItemProperty -Path $key -Name 'MANAGED'     -Value 1   -PropertyType DWord  -Force | Out-Null;
  New-ItemProperty -Path $key -Name 'LOADER'      -Value $dll -PropertyType String -Force | Out-Null;
  $n++;
};
if ($n -eq 0) { Write-Output 'NO_PRODUCTKEY'; } else { Write-Output ('OK:' + $n); }
exit 0;
`.trim();
      const out = execSync(`powershell.exe -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`, {
        windowsHide: true, timeout: 8000, encoding: 'utf8',
      }).trim();
      if (out === 'NO_BRANCH')
        logUpdate(`civil3d:bundle: AppLoader (${t.ver}/${regVer}) PULADO — Civil ${t.ver} nunca aberto (ramo ${regVer} inexistente).`);
      else if (out === 'NO_PRODUCTKEY')
        logUpdate(`civil3d:bundle: AppLoader (${t.ver}/${regVer}) sem ProductKey no registro.`);
      else
        logUpdate(`civil3d:bundle: AppLoader (${t.ver}/${regVer}) OK em ${out.replace('OK:', '')} ProductKey(s): ${dllPath}`);
    } catch (e) {
      logUpdate(`civil3d:bundle: AppLoader (${t.ver}) falhou: ` + e.message);
    }
  }
}

// Apaga a DLL extraída quando o Nexus fecha (lifecycle binding).
// Civil 3D pode ainda estar aberto e ter a DLL em memória — isso é OK,
// o que importa é que a DLL no disco desaparece junto com o Nexus.
app.on('before-quit', () => {
  try { c3dCleanupSync(); } catch {}
});

ipcMain.on('sign-out', ()=>{
  sessionUser = null;
  updateState = { status: 'idle', version: null };
  try { c3dCleanupSync(); } catch {}
  if (mainWindow) { mainWindow.close(); mainWindow = null; }
  createSplash();
});

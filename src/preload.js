// ── SENTRY (renderer) — inicia ANTES dos requires abaixo pra capturar erro de
// carga. Herda DSN/release do processo main (init em main.js). No-op se o main
// não estiver com Sentry configurado. ──
try { require('@sentry/electron/renderer').init({}); } catch (e) { /* sem sentry = segue normal */ }

const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { classifyOse, crossCheckPVs, buildCrossContext } = require('./oseStatus');
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

// Versão do app — lê do package.json. Fallback pra IPC se require falhar.
let _appVersion = null;
try {
  const pkg = require('./package.json');
  if (pkg?.version) _appVersion = pkg.version;
} catch(e) {
  try {
    const pkg = require('../package.json');
    if (pkg?.version) _appVersion = pkg.version;
  } catch(e2) {}
}
if (!_appVersion) {
  try { _appVersion = ipcRenderer.sendSync('get-app-version'); } catch(e) {}
}

// Com contextIsolation: false, podemos expor diretamente no window do renderer
window.electronAPI = {
  getAppVersion:     () => _appVersion,
  getLicense:        () => licenseData,
  getUpdateState:    () => ipcRenderer.sendSync('get-update-state'),
  signOut:           () => ipcRenderer.send('sign-out'),
  installUpdate:     () => ipcRenderer.send('install-update'),
  downloadUpdate:    () => ipcRenderer.send('download-update'),
  checkForUpdates:   () => ipcRenderer.send('check-for-updates'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, v)   => cb(v)),
  onUpdateProgress:  (cb) => ipcRenderer.on('update-progress',  (_, pct) => cb(pct)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update-downloaded', (_, v)   => cb(v)),
  onUpdateNotAvailable: (cb) => ipcRenderer.on('update-not-available', () => cb()),
  selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
  selectFolders: (defaultPath) => ipcRenderer.invoke('select-folders', defaultPath),
  readDir:      (p)          => ipcRenderer.invoke('read-dir', p),
  renameFiles:  (opts)       => ipcRenderer.invoke('rename-files', opts),
  selectFile:   (filters)    => ipcRenderer.invoke('select-file', filters),
  selectFiles:  (filters, defaultPath) => ipcRenderer.invoke('select-files', filters, defaultPath),
  parseOse:       (opts)       => ipcRenderer.invoke('parse-ose', opts),
  exportOseXlsx:  (opts)       => ipcRenderer.invoke('export-ose-xlsx', opts),
  exportCronogramaXlsx: (opts) => ipcRenderer.invoke('export-cronograma-xlsx', opts),
  classifyOse:    (r, ctx)     => classifyOse(r, ctx),
  buildCrossContext: (data, opts) => buildCrossContext(data, opts),
  crossCheckPVs:  (data)       => crossCheckPVs(data),
  deepCheckOse:   (data, opts) => deepCheckOse(data, opts),
  generateMemorial: (info, agg) => generateMemorial(info, agg),
  generateFromTemplate: (tplPath, info, agg) => generateFromTemplate(tplPath, info, agg),
  auditLog: {
    append:       (entry) => ipcRenderer.invoke('audit-log:append', entry),
    dir:          ()      => ipcRenderer.invoke('audit-log:dir'),
    list:         ()      => ipcRenderer.invoke('audit-log:list'),
    fetchIpGeo:   ()      => ipcRenderer.invoke('audit-log:fetch-ip-geo'),
    fetchGeoFine: ()      => ipcRenderer.invoke('audit-log:fetch-geo-fine'),
  },
  dashboard: {
    getData:        ()    => ipcRenderer.invoke('dashboard:get-data'),
    getHistory:     ()    => ipcRenderer.invoke('dashboard:get-history'),
    pickFile:       ()    => ipcRenderer.invoke('dashboard:pick-file'),
    getPublicLink:  ()    => ipcRenderer.invoke('dashboard:get-public-link'),
    onDataUpdated:  (cb)  => ipcRenderer.on('dashboard:data-updated', (_, data) => cb(data)),
  },
  // Reuniões — Fase 8: gravação de tela+áudio via desktopCapturer.
  // Fluxo:
  //   1. getScreenSources() → lista pra UI mostrar picker
  //   2. setSourceId(id) → UI registra a escolha no main
  //   3. UI chama navigator.mediaDevices.getDisplayMedia({video,audio})
  //   4. main intercepta via setDisplayMediaRequestHandler e usa o id registrado
  reunioes: {
    getScreenSources: () => ipcRenderer.invoke('reunioes:get-screen-sources'),
    setSourceId: (id) => ipcRenderer.invoke('reunioes:set-source-id', id),
  },
  topografia: {
    listarCidades: (pasta)   => ipcRenderer.invoke('topografia:listar-cidades', pasta),
    scanFotos:     (pasta)   => ipcRenderer.invoke('topografia:scan-fotos', pasta),
    scanFotosArquivos: (paths) => ipcRenderer.invoke('topografia:scan-fotos-arquivos', paths),
    converterArt:  (paths)   => ipcRenderer.invoke('topografia:converter-art', paths),
    configGet:     ()        => ipcRenderer.invoke('topografia:config-get'),
    configSet:     (patch)   => ipcRenderer.invoke('topografia:config-set', patch),
    gerarLote:     (params)  => ipcRenderer.invoke('topografia:gerar-lote', params),
    previewCidade: (params)  => ipcRenderer.invoke('topografia:preview-cidade', params),
    abrirPasta:    (p)       => ipcRenderer.invoke('topografia:abrir-pasta', p),
    onProgresso:   (cb) => {
      const handler = (_e, data) => { try { cb(data); } catch {} };
      ipcRenderer.on('topografia:progresso', handler);
      return () => ipcRenderer.off('topografia:progresso', handler);
    },
  },
  // Orçamento RCE — gera orçamento de Rede Coletora de Esgoto a partir de
  // um arquivo de OSEs, via gerador Python (scripts/orcamento).
  orcRce: {
    selectOses: ()      => ipcRenderer.invoke('orc-rce:select-oses'),
    pickSave:   (name)  => ipcRenderer.invoke('orc-rce:pick-save', name),
    gerar:      (cfg)   => ipcRenderer.invoke('orc-rce:gerar', cfg),
    abrir:      (p)     => ipcRenderer.invoke('orc-rce:abrir', p),
  },
  // Orçamento de Elevatória (EEE) — gera o orçamento de Estação Elevatória a
  // partir do gabarito A2 + dados de entrada do projeto, via wrapper Python
  // (scripts/orcamento-elevatoria). Excel COM → Python real + Excel.
  orcElev: {
    schema:     ()      => ipcRenderer.invoke('orc-elev:schema'),
    a2Default:  ()      => ipcRenderer.invoke('orc-elev:a2-default'),
    pickA2:     ()      => ipcRenderer.invoke('orc-elev:pick-a2'),
    pickPdf:    ()      => ipcRenderer.invoke('orc-elev:pick-pdf'),
    pickSave:   (name)  => ipcRenderer.invoke('orc-elev:pick-save', name),
    gerar:      (cfg)   => ipcRenderer.invoke('orc-elev:gerar', cfg),
    abrir:      (p)     => ipcRenderer.invoke('orc-elev:abrir', p),
    cotacoesList:   ()   => ipcRenderer.invoke('orc-elev:cotacoes-list'),
    cotacoesAdd:    (c)  => ipcRenderer.invoke('orc-elev:cotacoes-add', c),
    cotacoesAddDoc: (m)  => ipcRenderer.invoke('orc-elev:cotacoes-add-doc', m),
    cotacoesDel:    (id) => ipcRenderer.invoke('orc-elev:cotacoes-del', id),
    cotacoesAbrir:  (id) => ipcRenderer.invoke('orc-elev:cotacoes-abrir', id),
    onProgresso: (cb) => {
      const handler = (_e, msg) => { try { cb(msg); } catch {} };
      ipcRenderer.on('orc-elev:progresso', handler);
      return () => ipcRenderer.off('orc-elev:progresso', handler);
    },
  },
  // RH — Banco de Currículos (índice local + busca por palavra-chave).
  rhCv: {
    importarPasta:    ()      => ipcRenderer.invoke('rh-cv:importar-pasta'),
    adicionarArquivos:()      => ipcRenderer.invoke('rh-cv:adicionar-arquivos'),
    buscar:           (q,filtros) => ipcRenderer.invoke('rh-cv:buscar', { query:q, filtros:filtros||{} }),
    reindex:          ()      => ipcRenderer.invoke('rh-cv:reindex'),
    excluir:          (ids)   => ipcRenderer.invoke('rh-cv:excluir', ids),
    abrir:            (p)     => ipcRenderer.invoke('rh-cv:abrir', p),
  },
  // Memorial Descritivo RCE — gera o .docx do Memorial Descritivo a partir
  // dos arquivos do projeto (OSE/TXT/soleiras/interferencias) + dados do
  // projeto + construtor de fluxograma, via gerador Python (scripts/memorial).
  memorial: {
    pickFile: (kind)   => ipcRenderer.invoke('memorial:pick-file', kind),
    pickDir:  (kind)   => ipcRenderer.invoke('memorial:pick-dir', kind),
    pickSave: (name)   => ipcRenderer.invoke('memorial:pick-save', name),
    gerar:    (cfg)    => ipcRenderer.invoke('memorial:gerar', cfg),
    abrir:    (p)      => ipcRenderer.invoke('memorial:abrir', p),
  },
  // Monografia de Marco Topográfico — gera o .docx a partir do PDF do PPP-IBGE
  // (+ fotos opcionais), via pipeline Python (jarvis/gerar_monografia.py).
  monografia: {
    gerar:       (params) => ipcRenderer.invoke('monografia:gerar', params),
    abrir:       (p)      => ipcRenderer.invoke('monografia:abrir', p),
    onProgresso: (cb) => {
      const handler = (_e, msg) => { try { cb(msg); } catch {} };
      ipcRenderer.on('monografia:progresso', handler);
      return () => ipcRenderer.off('monografia:progresso', handler);
    },
  },
  // Abas Excel → PDF — exporta cada aba de uma planilha como um PDF separado
  // (nome do PDF = nome da aba), via motor Python (Excel COM).
  abasPdf: {
    selectXlsx: ()    => ipcRenderer.invoke('abas-pdf:select-xlsx'),
    pickDir:    ()    => ipcRenderer.invoke('abas-pdf:pick-dir'),
    gerar:      (cfg) => ipcRenderer.invoke('abas-pdf:gerar', cfg),
    abrir:      (p)   => ipcRenderer.invoke('abas-pdf:abrir', p),
  },
  civil3dBundle: {
    status:    () => ipcRenderer.invoke('civil3d:bundle:status'),
    install:   () => ipcRenderer.invoke('civil3d:bundle:install'),
    uninstall: () => ipcRenderer.invoke('civil3d:bundle:uninstall'),
    onNeedsCadRestart: (cb) => {
      // Aviso disparado pelo main quando o auto-install do bundle falhou
      // porque o Civil 3D estava aberto e segurou a DLL antiga.
      const handler = () => { try { cb(); } catch {} };
      ipcRenderer.on('civil3d:bundle:needs-cad-restart', handler);
      return () => ipcRenderer.off('civil3d:bundle:needs-cad-restart', handler);
    },
  },
};

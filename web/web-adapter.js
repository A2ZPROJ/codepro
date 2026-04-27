/* ============================================================
 * web-adapter.js — PWA (browser) adapter pro Nexus
 * ----------------------------------------------------------------
 * Substitui o `window.electronAPI` que no desktop vem do preload.
 * Todas as assinaturas são iguais: quem chamar `window.electronAPI.selectFile()`
 * no desktop OU no browser recebe o mesmo formato de retorno.
 * ============================================================ */

(function(){
  'use strict';

  // ---- Shim global: require() no browser ---------------------------
  // O código original faz `require('fs')`, `require('xlsx')` etc. em
  // alguns pontos. No browser isso explode. Esse shim devolve
  // equivalentes browser-safe quando possível, e objeto vazio quando não.
  var __stubs = {
    'fs': { readFileSync: function(){ throw new Error('fs indisponível no browser'); }, existsSync: function(){ return false; }, writeFileSync: function(){}, openSync: function(){ throw new Error('fs indisponível no browser'); } },
    'path': {
      join: function(){ return Array.prototype.join.call(arguments, '/').replace(/\/+/g,'/'); },
      basename: function(p){ return String(p||'').split(/[\\/]/).pop(); },
      dirname: function(p){ var s = String(p||''); var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i<0?'':s.slice(0,i); },
      extname: function(p){ var s = String(p||''); var i = s.lastIndexOf('.'); return i<0?'':s.slice(i); },
      sep: '/',
    },
    'os': { homedir: function(){ return '/'; }, tmpdir: function(){ return '/tmp'; } },
    'electron': { ipcRenderer: { send:function(){}, sendSync:function(){return {};}, invoke:function(){return Promise.resolve(null);}, on:function(){} } },
    'worker_threads': { Worker: function(){}, isMainThread: true, parentPort: null },
    'stream': { Readable: function(){}, Writable: function(){}, Transform: function(){} },
    '../../package.json': { version: '2.19.3-web', name: 'nexus-pwa' },
    '../package.json': { version: '2.19.3-web', name: 'nexus-pwa' },
    './package.json': { version: '2.19.3-web', name: 'nexus-pwa' },
  };
  if (typeof window.require !== 'function') {
    // Silenciar warnings de módulos conhecidos — esses sempre vão cair aqui e tá tudo bem
    var silentStubs = { 'worker_threads': 1, 'stream': 1, '../../package.json': 1, '../package.json': 1, './package.json': 1, 'crypto': 1, 'buffer': 1, 'util': 1, 'events': 1 };
    window.require = function(name){
      if (name === 'xlsx' && window.XLSX) return window.XLSX;
      if (name === 'jszip' && window.JSZip) return window.JSZip;
      if (name === 'html2canvas' && window.html2canvas) return window.html2canvas;
      if (name === 'exceljs' && window.ExcelJS) return window.ExcelJS;
      if (name === 'pdfmake/build/pdfmake' && window.pdfMake) return window.pdfMake;
      if (name === 'pdfmake/build/vfs_fonts' && window.pdfMake) return { vfs: window.pdfMake.vfs, pdfMake: { vfs: window.pdfMake.vfs } };
      if (name === 'pdfmake' && window.pdfMake) return window.pdfMake;
      if (__stubs[name]) return __stubs[name];
      if (!silentStubs[name]) console.warn('[web-adapter] require("' + name + '") stubbed as {}');
      return {};
    };
  }
  // Sinaliza ambiente
  window.__NEXUS_WEB__ = true;
  window.__NEXUS_ELECTRON__ = false;

  // ---- Hamburger mobile ------------------------------------------
  // Cria o botão hamburger e a lógica de abrir/fechar a sidebar.
  // mobile.css tem o estilo (#mobile-hamburger + body.sidebar-open).
  function isMobile(){ return window.matchMedia('(max-width: 768px)').matches; }
  function setupMobileNav(){
    if (document.getElementById('mobile-hamburger')) return;
    if (!isMobile()) return; // só ativa em telas pequenas
    var btn = document.createElement('button');
    btn.id = 'mobile-hamburger';
    btn.setAttribute('aria-label', 'Abrir menu');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>';
    document.body.appendChild(btn);
    btn.addEventListener('click', function(ev){
      ev.stopPropagation();
      document.body.classList.toggle('sidebar-open');
    });
    // Click no overlay (backdrop ::before do body) ou em sb-item fecha
    document.addEventListener('click', function(ev){
      if (!document.body.classList.contains('sidebar-open')) return;
      var sidebar = document.querySelector('.sidebar, aside.sidebar, #sidebar, .sb-root, aside[role="navigation"]');
      if (!sidebar) return;
      // Click DENTRO de um sb-item → fecha (após troca de aba)
      if (ev.target.closest && ev.target.closest('.sb-item')) {
        setTimeout(function(){ document.body.classList.remove('sidebar-open'); }, 50);
        return;
      }
      // Click fora da sidebar e fora do botão → fecha
      if (!sidebar.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) {
        document.body.classList.remove('sidebar-open');
      }
    });
    // Tecla ESC fecha
    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape') document.body.classList.remove('sidebar-open');
    });
  }
  // Tenta criar imediatamente E após o app montar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupMobileNav);
  } else {
    setupMobileNav();
  }
  // Re-tenta quando o app monta (sidebar pode aparecer depois)
  window.addEventListener('nexus:login-ok', function(){ setTimeout(setupMobileNav, 200); });
  // Reabilita ao redimensionar (rotação de tela)
  window.addEventListener('resize', function(){
    if (!isMobile()) {
      var b = document.getElementById('mobile-hamburger'); if (b) b.remove();
      document.body.classList.remove('sidebar-open');
    } else setupMobileNav();
  });

  // ---- Registra Service Worker ------------------------------------
  // SW cuida de cache offline + auto-update via versão do sw.js
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('./sw.js').then(function(reg){
        // Quando o SW novo terminar de instalar, força ativação
        reg.addEventListener('updatefound', function(){
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function(){
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              // Já tem SW antigo controlando: força o novo
              nw.postMessage('SKIP_WAITING');
            }
          });
        });
      }).catch(function(e){
        console.warn('[web-adapter] SW register falhou:', e);
      });
    });
  }

  // ---- Força navigator.onLine = true no PWA ----------------------
  // Motivo: iOS Safari reporta onLine=false em Wi-Fi local sem uplink,
  // ou em PWA standalone mode. Se a página carregou, o usuário tem rede
  // suficiente pro app. O check real de conectividade é se o Supabase
  // responde — isso cada fluxo trata por conta própria.
  try {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: function(){ return true; }
    });
  } catch(e) { /* alguns browsers não deixam redefinir */ }

  // ---- Store local (substitui ~/.codepro/config.json) --------------
  // Persiste em localStorage E cookie. Safari iOS às vezes limpa o
  // localStorage do PWA standalone — cookie tem mais chance de sobreviver.
  var STORE_KEY = 'nexus_web_store_v1';
  var COOKIE_KEY = 'nexus_lic';

  function setCookie(name, value, days) {
    try {
      var d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
      // SameSite=Lax pra cobrir navegação entre tabs sem perder
      document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
    } catch(e) {}
  }
  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch(e) { return null; }
  }
  function delCookie(name) { setCookie(name, '', -1); }

  var webStore = {
    _load: function(){
      try {
        var ls = localStorage.getItem(STORE_KEY);
        if (ls) return JSON.parse(ls);
      } catch(e) {}
      // Fallback: cookie
      try {
        var ck = getCookie(COOKIE_KEY);
        if (ck) {
          var data = JSON.parse(ck);
          // Restaura no localStorage também
          try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch(e){}
          return data;
        }
      } catch(e) {}
      return {};
    },
    _save: function(obj){
      var json = JSON.stringify(obj);
      try { localStorage.setItem(STORE_KEY, json); } catch(e){}
      // Cookie só armazena dados leves (license + last_name); cookies têm limite ~4KB
      try {
        var lite = { license: obj.license, last_name: obj.last_name };
        setCookie(COOKIE_KEY, JSON.stringify(lite), 30);  // 30 dias
      } catch(e){}
    },
    get: function(k){ var d = this._load(); return d[k]; },
    set: function(k,v){ var d = this._load(); d[k]=v; this._save(d); },
    delete: function(k){ var d = this._load(); delete d[k]; this._save(d); if (k === 'license') delCookie(COOKIE_KEY); },
  };
  window.__webStore = webStore;

  // ---- FilePicker helpers ------------------------------------------
  function openFilePicker(opts){
    return new Promise(function(resolve){
      var inp = document.createElement('input');
      inp.type = 'file';
      if (opts && opts.accept) inp.accept = opts.accept;
      if (opts && opts.multiple) inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      var done = false;
      inp.addEventListener('change', function(){
        done = true;
        var files = Array.from(inp.files || []);
        document.body.removeChild(inp);
        resolve(files);
      });
      // Detecta cancelamento (nem todo browser dispara 'cancel')
      inp.addEventListener('cancel', function(){
        done = true;
        try { document.body.removeChild(inp); } catch(e){}
        resolve([]);
      });
      setTimeout(function(){
        // timeout de segurança — se user não interagiu em 5min, limpa
        if (!done) { try { document.body.removeChild(inp); } catch(e){} resolve([]); }
      }, 300000);
      inp.click();
    });
  }

  function filtersToAccept(filters){
    if (!filters || !filters.length) return '';
    var acc = [];
    filters.forEach(function(f){
      (f.extensions||[]).forEach(function(ext){ acc.push('.' + ext); });
    });
    return acc.join(',');
  }

  // Converte File → { path, name, data } que o código desktop espera.
  // No web, "path" vira um ObjectURL/fakepath — quem recebe precisa usar
  // a propriedade `file` (File object) pra ler conteúdo.
  function fileToShim(file){
    return {
      path: file.name,          // legado: algumas chamadas usam só pra exibir
      name: file.name,
      size: file.size,
      mtimeMs: file.lastModified,
      file: file,               // objeto File real
    };
  }

  // ---- Directory picker (File System Access API quando disponível) --
  async function pickDirectory(){
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        var handle = await window.showDirectoryPicker({ mode: 'read' });
        return handle;
      } catch(e){ return null; }
    }
    // Fallback: input webkitdirectory — user escolhe pasta, recebemos todos os files
    return new Promise(function(resolve){
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.webkitdirectory = true;
      inp.multiple = true;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', function(){
        var files = Array.from(inp.files || []);
        document.body.removeChild(inp);
        // Emula um "directory handle" simples
        var pseudoRoot = (files[0] && files[0].webkitRelativePath) ? files[0].webkitRelativePath.split('/')[0] : 'pasta';
        resolve({
          __pseudo: true,
          name: pseudoRoot,
          _files: files,
          async* values(){
            for (var f of files) {
              yield { kind: 'file', name: f.name, _file: f, getFile: async function(){ return this._file; } };
            }
          },
        });
      });
      inp.click();
    });
  }

  // Lista arquivos dentro de um handle de diretório (FSA) ou pseudo-dir
  async function listDirectoryFiles(handle){
    if (!handle) return [];
    var out = [];
    if (handle.__pseudo) {
      handle._files.forEach(function(f){
        out.push({ name: f.name, isDirectory: false, size: f.size, mtimeMs: f.lastModified, _file: f });
      });
      return out;
    }
    // FSA API
    try {
      for await (var entry of handle.values()) {
        if (entry.kind === 'file') {
          try {
            var f = await entry.getFile();
            out.push({ name: entry.name, isDirectory: false, size: f.size, mtimeMs: f.lastModified, _file: f });
          } catch(e) {
            out.push({ name: entry.name, isDirectory: false });
          }
        } else if (entry.kind === 'directory') {
          out.push({ name: entry.name, isDirectory: true });
        }
      }
    } catch(e) {}
    return out;
  }

  // ---- Utilitários download ----------------------------------------
  function downloadBlob(blob, filename){
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }
  window.__downloadBlob = downloadBlob;

  // ---- Licença/Session (cache em localStorage) ---------------------
  function getLicense(){
    return webStore.get('license') || null;
  }
  function setLicense(lic){
    webStore.set('license', lic);
  }
  function signOut(){
    webStore.delete('license');
    location.reload();
  }
  window.__webLogin = {
    getLicense: getLicense,
    setLicense: setLicense,
    signOut: signOut,
  };

  // ---- parseOse no browser ------------------------------------------
  // O módulo original lê arquivos via fs.readFileSync. Aqui a gente
  // pré-lê os Files (via FileReader) e monta strings/ArrayBuffers que
  // parseOse consegue usar — ou, se o módulo não foi carregado (ainda),
  // fallback pra mensagem "use desktop".
  async function readFileAsText(file){
    return new Promise(function(resolve, reject){
      var fr = new FileReader();
      fr.onload = function(){ resolve(fr.result); };
      fr.onerror = function(){ reject(fr.error); };
      fr.readAsText(file);
    });
  }
  async function readFileAsArrayBuffer(file){
    return new Promise(function(resolve, reject){
      var fr = new FileReader();
      fr.onload = function(){ resolve(fr.result); };
      fr.onerror = function(){ reject(fr.error); };
      fr.readAsArrayBuffer(file);
    });
  }
  window.__readFileAsText = readFileAsText;
  window.__readFileAsArrayBuffer = readFileAsArrayBuffer;

  // ---- window.electronAPI (web) ------------------------------------
  // Implementação completa: mesmas assinaturas, resultados equivalentes.
  if (!window.electronAPI) {
    window.electronAPI = {
      // --- Licença e sessão ---
      getLicense: function(){ return getLicense(); },
      getUpdateState: function(){ return { status: 'idle', version: null }; },
      signOut: function(){ signOut(); },
      installUpdate: function(){ location.reload(); },
      downloadUpdate: function(){},
      checkForUpdates: function(){
        // No PWA, o service worker já cuida disso automaticamente
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.getRegistrations().then(function(regs){
            regs.forEach(function(r){ r.update(); });
          });
        }
      },
      onUpdateAvailable: function(cb){ /* no-op: PWA usa SW */ },
      onUpdateProgress:  function(cb){ /* no-op */ },
      onUpdateDownloaded: function(cb){
        // Quando um novo SW estiver pronto, notifica
        if (navigator.serviceWorker) {
          navigator.serviceWorker.addEventListener('controllerchange', function(){
            try { cb('nova versão'); } catch(e){}
          });
        }
      },
      onUpdateNotAvailable: function(cb){ /* no-op */ },

      // --- File pickers ---
      selectFile: async function(filters){
        var files = await openFilePicker({ accept: filtersToAccept(filters) });
        if (!files.length) return null;
        return fileToShim(files[0]);
      },
      selectFiles: async function(filters){
        var files = await openFilePicker({ accept: filtersToAccept(filters), multiple: true });
        return files.map(fileToShim);
      },
      selectFolder: async function(){
        var handle = await pickDirectory();
        if (!handle) return null;
        // Persiste o handle por id pra uso posterior em readDir/renameFiles
        var id = '_dir_' + Date.now();
        window.__dirHandles = window.__dirHandles || {};
        window.__dirHandles[id] = handle;
        return id;
      },
      readDir: async function(id){
        var handle = (window.__dirHandles || {})[id];
        if (!handle) return [];
        var entries = await listDirectoryFiles(handle);
        return entries;
      },
      renameFiles: async function(opts){
        // No web, não dá pra renomear arquivos no FS do usuário diretamente
        // (sem permissões write via FSA API). Gera ZIP com os arquivos
        // renomeados e oferece download.
        if (!window.JSZip) {
          return { ok: false, error: 'JSZip não carregou' };
        }
        var zip = new window.JSZip();
        var dirId = opts && opts.dirId;
        var mappings = (opts && opts.mappings) || []; // [{oldName, newName}]
        var handle = (window.__dirHandles || {})[dirId];
        if (!handle) return { ok: false, error: 'Pasta não selecionada' };
        var entries = await listDirectoryFiles(handle);
        var byName = {}; entries.forEach(function(e){ if (e._file) byName[e.name] = e._file; });
        var applied = 0;
        for (var m of mappings) {
          var f = byName[m.oldName];
          if (!f) continue;
          var buf = await readFileAsArrayBuffer(f);
          zip.file(m.newName, buf);
          applied++;
        }
        var blob = await zip.generateAsync({ type: 'blob' });
        downloadBlob(blob, 'renomeados.zip');
        return { ok: true, renamed: applied, mode: 'zip' };
      },

      // --- OSE: parse / classify / cross / deep / export ---
      parseOse: async function(opts){
        // opts pode vir com { mapaDxf, perfisDxf, excelPath } (paths) OU
        // direto com File objects (enriquecidos pela UI web).
        if (!window.__nexusParseOse) {
          return { ok: false, error: 'Parser OSE não carregou' };
        }
        try {
          return await window.__nexusParseOse(opts);
        } catch(e) {
          return { ok: false, error: e.message || String(e) };
        }
      },
      classifyOse: function(r){
        return window.__nexusClassifyOse ? window.__nexusClassifyOse(r) : r;
      },
      crossCheckPVs: function(data){
        return window.__nexusCrossCheckPVs ? window.__nexusCrossCheckPVs(data) : [];
      },
      deepCheckOse: function(data){
        return window.__nexusDeepCheck ? window.__nexusDeepCheck(data) : null;
      },
      exportOseXlsx: async function(opts){
        if (!window.__nexusExportOseXlsx) return { ok:false, error:'export não carregou' };
        try {
          var blob = await window.__nexusExportOseXlsx(opts);
          downloadBlob(blob, (opts && opts.filename) || 'conferencia-ose.xlsx');
          return { ok: true, mode: 'download' };
        } catch(e){ return { ok: false, error: e.message }; }
      },
      generateMemorial: async function(info, agg){
        if (!window.__nexusGenMemorial) return null;
        var blob = await window.__nexusGenMemorial(info, agg);
        downloadBlob(blob, 'memorial-descritivo.docx');
        return { ok: true };
      },
      generateFromTemplate: async function(tplPath, info, agg){
        // No web, tplPath é um File. A UI web passa File em vez de path.
        if (!window.__nexusGenTemplate) return null;
        var blob = await window.__nexusGenTemplate(tplPath, info, agg);
        downloadBlob(blob, 'memorial-template.docx');
        return { ok: true };
      },

      // --- Dashboard externo ---
      dashboard: {
        getData: async function(){
          // No desktop vem do parser local. No web lê direto do Supabase.
          try {
            if (!window.sb) return null;
            var r = await window.sb.from('dashboard_snapshots').select('*').order('created_at', { ascending: false }).limit(1).single();
            return r.data && r.data.payload ? r.data.payload : null;
          } catch(e){ return null; }
        },
        getHistory: async function(){
          try {
            if (!window.sb) return [];
            var r = await window.sb.from('dashboard_snapshots').select('id,created_at,source_name').order('created_at', { ascending: false }).limit(20);
            return r.data || [];
          } catch(e){ return []; }
        },
        pickFile: async function(){
          var files = await openFilePicker({ accept: '.xlsx,.xls' });
          if (!files.length) return null;
          return fileToShim(files[0]);
        },
        getPublicLink: function(){
          // Dashboard público já existe (gh-pages do A2ZPROJ/DASHBOARD-DIRETORIA)
          return 'https://a2zproj.github.io/DASHBOARD-DIRETORIA/';
        },
        onDataUpdated: function(cb){ /* no-op no web */ },
      },
    };
  }

  // ---- Detecta primeira execução → mostra login se sem licença -----
  // (o login em si é feito pelo web-login.js, carregado antes do app)

  console.log('[web-adapter] carregado — ambiente PWA (browser)');
})();

/* ============================================================
 * web-login.js — tela de ativação / login do Nexus Web (PWA)
 * ----------------------------------------------------------------
 * Replica a lógica do src/splash.html adaptada pra browser:
 *   - lê licença cacheada em localStorage (__webStore)
 *   - se não tem ou expirou → mostra overlay de login
 *   - valida access_code contra Supabase REST
 *   - salva licença e chama onLoginOk()
 *
 * Roda ANTES do app montar. Expõe window.__LICENSE__ (mesmo contrato
 * do desktop) pra que o `init()` do index.html reconheça a sessão.
 * ============================================================ */

(function(){
  'use strict';

  var SUPA_URL = 'https://xszpzsmdpbgaiodeqcpi.supabase.co';
  var SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhzenB6c21kcGJnYWlvZGVxY3BpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTI5ODYsImV4cCI6MjA4OTg4ODk4Nn0.Wv_tcovD5nc13tmrfkgsVb6M6tS-CC7q6HVjphpzTrQ';
  var OFFLINE_TTL_DAYS = 7;

  function store(){ return window.__webStore; }

  async function queryUser(code){
    try {
      var r = await fetch(SUPA_URL + '/rest/v1/usuarios?access_code=eq.' + encodeURIComponent(code) + '&limit=1&select=*', {
        headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
      });
      if (!r.ok) return null;
      var users = await r.json();
      return (users && users.length) ? users[0] : null;
    } catch(e) { return null; }
  }

  function renderOverlay(){
    var wrap = document.createElement('div');
    wrap.id = 'web-login-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:999999;background:#060d1b;color:#f0f4ff;display:flex;align-items:center;justify-content:center;font-family:"DM Sans","Inter",system-ui,sans-serif;padding:20px;overflow-y:auto';
    wrap.innerHTML = ''+
      '<div style="width:100%;max-width:420px;background:#0a1224;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px 24px;box-shadow:0 40px 120px rgba(0,0,0,.5)">'+
        '<div style="text-align:center;margin-bottom:22px">'+
          '<div style="font-size:12px;font-weight:700;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">A2Z Projetos</div>'+
          '<div style="font-size:24px;font-weight:800;color:#f1f5f9;letter-spacing:.5px">NEXUS <span style="font-size:11px;font-weight:500;color:#3b82f6;background:rgba(59,130,246,.12);padding:3px 7px;border-radius:6px;vertical-align:middle;margin-left:4px">MOBILE</span></div>'+
          '<div style="font-size:12px;color:#475569;margin-top:4px">Gestão de projetos de saneamento</div>'+
        '</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Nome completo</label>'+
          '<input id="wl-name" type="text" autocomplete="name" placeholder="João da Silva" style="width:100%;padding:11px 12px;font-size:13px;font-family:inherit;background:#0f172a;border:1.5px solid #1e293b;border-radius:8px;color:#f1f5f9;outline:none"/>'+
        '</div>'+
        '<div style="margin-bottom:16px">'+
          '<label style="display:block;font-size:11px;font-weight:600;color:#94a3b8;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Código de acesso</label>'+
          '<input id="wl-key" type="text" inputmode="text" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX" style="width:100%;padding:11px 12px;font-size:14px;font-family:\'JetBrains Mono\',\'DM Mono\',monospace;background:#0f172a;border:1.5px solid #1e293b;border-radius:8px;color:#f1f5f9;outline:none;letter-spacing:3px;text-align:center;text-transform:uppercase"/>'+
        '</div>'+
        '<div id="wl-error" style="font-size:12px;color:#f87171;min-height:18px;margin-bottom:12px;text-align:center"></div>'+
        '<button id="wl-btn" style="width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">Entrar</button>'+
        '<div style="font-size:11px;color:#475569;text-align:center;margin-top:16px;line-height:1.5">Use o mesmo código do Nexus Desktop.<br/>Login cacheado por ' + OFFLINE_TTL_DAYS + ' dias — funciona offline depois.</div>'+
      '</div>';
    document.body.appendChild(wrap);

    var keyInp = wrap.querySelector('#wl-key');
    keyInp.addEventListener('input', function(){
      var v = keyInp.value.replace(/[^A-Z0-9]/gi,'').toUpperCase();
      if (v.length > 4) v = v.slice(0,4) + '-' + v.slice(4,8);
      keyInp.value = v;
    });

    var btn = wrap.querySelector('#wl-btn');
    var nameInp = wrap.querySelector('#wl-name');
    var err = wrap.querySelector('#wl-error');

    function showError(msg){ err.textContent = msg; }

    async function doLogin(){
      showError('');
      var name = nameInp.value.trim();
      var raw = keyInp.value.replace(/[^A-Z0-9]/gi,'').toUpperCase();
      if (!name) { showError('Informe seu nome.'); return; }
      if (raw.length < 8) { showError('Código incompleto (XXXX-XXXX).'); return; }
      var code = raw.slice(0,4) + '-' + raw.slice(4,8);
      if (!navigator.onLine) { showError('Sem conexão. Conecte à internet pro primeiro login.'); return; }

      btn.disabled = true;
      btn.textContent = 'Verificando...';
      var user = await queryUser(code);
      btn.disabled = false;
      btn.textContent = 'Entrar';

      if (!user) { showError('Código inválido.'); return; }
      if (user.ativo === false) { showError('Acesso desativado. Contate o admin.'); return; }
      if (user.license_expires) {
        var today = new Date(); today.setHours(0,0,0,0);
        var exp = new Date(user.license_expires + 'T00:00:00');
        if (today > exp) { showError('Licença expirada em ' + exp.toLocaleDateString('pt-BR')); return; }
      }

      user.last_online_login = Date.now();
      store().set('license', user);
      finalize(user);
    }

    btn.addEventListener('click', doLogin);
    [nameInp, keyInp].forEach(function(i){
      i.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') doLogin(); });
    });

    // Auto-foco no campo certo
    setTimeout(function(){
      var existingName = store().get('last_name');
      if (existingName) { nameInp.value = existingName; keyInp.focus(); }
      else nameInp.focus();
    }, 50);
  }

  function finalize(user){
    window.__LICENSE__ = user;
    var overlay = document.getElementById('web-login-overlay');
    if (overlay) overlay.remove();
    store().set('last_name', user.nome || '');
    // Dispara o init do app (o script module do index.html espera __LICENSE__)
    window.dispatchEvent(new CustomEvent('nexus:login-ok', { detail: user }));
  }

  function ageDays(ts){ return (Date.now() - (ts||0)) / (1000*60*60*24); }

  function boot(){
    var cached = store().get('license');
    if (cached && cached.id) {
      // Re-valida online se der, senão segue com cache
      if (navigator.onLine) {
        queryUser(cached.access_code).then(function(fresh){
          if (fresh && fresh.ativo !== false) {
            var merged = Object.assign({}, cached, fresh, { last_online_login: Date.now() });
            store().set('license', merged);
            finalize(merged);
          } else {
            // Se revalidação falhou mas ainda tá dentro do TTL offline, usa cached
            if (ageDays(cached.last_online_login) <= OFFLINE_TTL_DAYS) {
              finalize(cached);
            } else {
              store().delete('license');
              renderOverlay();
            }
          }
        }).catch(function(){
          if (ageDays(cached.last_online_login) <= OFFLINE_TTL_DAYS) finalize(cached);
          else renderOverlay();
        });
      } else {
        if (ageDays(cached.last_online_login) <= OFFLINE_TTL_DAYS) finalize(cached);
        else renderOverlay();
      }
    } else {
      renderOverlay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

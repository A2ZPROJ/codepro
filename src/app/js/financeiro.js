/* ════════════════════════════════════════════════════════════════════════
   FINANCEIRO — aba privada do Lucas (pessoal + A2Z PJ)
   ------------------------------------------------------------------------
   - Dados 100% LOCAIS e CRIPTOGRAFADOS (AES-256-GCM). A chave é derivada da
     senha do Lucas via scrypt. Sem a senha, o arquivo é ilegível — nem o
     Supabase nem outro usuário do Nexus enxergam nada.
   - Arquivo: %USERPROFILE%\.codepro\financeiro.enc
   - Senha pedida ao abrir a aba; fica em memória só enquanto o app está
     aberto (lembra na sessão). Fechou o Nexus, pede de novo.
   - Funcionalidades: lançamentos (entradas/saídas, recorrência, status),
     contas/saldos, dívidas, cotas/investimentos, dashboard, PREVISÃO de
     saldo e ANÁLISE inteligente (onde cortar, o que mais consome, alertas).

   Padrão visual: usa as variáveis CSS do Nexus (var(--surface) etc.) e os
   helpers globais nexusPrompt/nexusConfirm/toast quando existem.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const crypto = require('crypto');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  // ── Arquivo de dados ────────────────────────────────────────────────────
  const DIR = path.join(os.homedir(), '.codepro');
  const FILE = path.join(DIR, 'financeiro.enc');
  const MAGIC = 'NXFIN1';

  // ── Estado em memória ───────────────────────────────────────────────────
  let _key = null;          // Buffer da chave AES (derivada da senha) — só na sessão
  let _data = null;         // objeto de dados descriptografado
  let _initialized = false; // UI já montada uma vez
  let _curView = 'dashboard';
  let _escopo = 'pessoal';  // 'pessoal' | 'a2z'

  // Só o LUCAS vê a parte PESSOAL. Matheus (sócio A2Z) vê só A2Z (PJ).
  // Critério: access_code A2ZP-MSTR ou e-mail do Lucas (a parte pessoal é dele).
  function ehLucas() {
    try {
      var u = window._currentUserData || {};
      var lic = window.__LICENSE__ || (window.electronAPI && window.electronAPI.getLicense && window.electronAPI.getLicense()) || {};
      var code = (lic.access_code || u.access_code || '').toUpperCase();
      var email = (lic.email || u.email || '').toLowerCase();
      return code === 'A2ZP-MSTR'
        || email === 'lucas.abdala@a2zprojetos.com.br'
        || email === 'lucas.nasser@2sagrimensura.com.br';
    } catch (e) { return false; }
  }

  // ── Modelo de dados padrão ──────────────────────────────────────────────
  function emptyData() {
    return {
      v: 1,
      contas: [],        // {id,nome,tipo,escopo,saldoInicial}
      lancamentos: [],   // {id,data,descricao,valor,tipo,categoria,contaId,escopo,recorrente,freq,status,vencimento}
      dividas: [],       // {id,credor,escopo,valorTotal,saldoDevedor,parcela,parcelasTotais,parcelasPagas,jurosMes,diaVcto}
      cotas: [],         // {id,nome,escopo,instituicao,aporte,valorAtual,dataAporte}
      metas: [],         // {id,escopo,nome,alvo,guardado,prazo}
      orcamento: {},     // { pessoal:{Categoria:limite}, a2z:{...} }  limite mensal planejado
      rendasFixas: [],   // {id,escopo,nome,valor,categoria,dia}  ganhos fixos pré-setados
      categorias: DEFAULT_CATS.slice(),
      // % de alocação da renda por grupo (regra 50/30/20 adaptada). Soma ~100.
      alocacao: { pessoal: { fixa: 50, variavel: 15, investimento: 20, diversos: 15 },
                  a2z:     { fixa: 60, variavel: 20, investimento: 15, diversos: 5 } },
      config: { criadoEm: new Date().toISOString(), reservaMeses: 6 },
    };
  }

  // Categorias. tipo: 'saida' | 'entrada'. grupo (saídas): 'fixa'|'variavel'|'investimento'|'diversos'.
  // essencial mantido p/ compatibilidade (fixa+investimento contam como essencial).
  const DEFAULT_CATS = [
    // ── ENTRADAS ──
    { nome: 'Salário', tipo: 'entrada' }, { nome: 'Pró-labore', tipo: 'entrada' },
    { nome: 'Freelance / Extra', tipo: 'entrada' }, { nome: 'Rendimentos', tipo: 'entrada' },
    { nome: 'Dividendos', tipo: 'entrada' }, { nome: 'Outras receitas', tipo: 'entrada' },
    // ── SAÍDAS FIXAS (essenciais) ──
    { nome: 'Moradia', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Contas/Utilidades', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Educação', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Saúde', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Impostos', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Funcionários', tipo: 'saida', grupo: 'fixa', essencial: true },
    { nome: 'Seguros', tipo: 'saida', grupo: 'fixa', essencial: true },
    // ── SAÍDAS VARIÁVEIS ──
    { nome: 'Alimentação', tipo: 'saida', grupo: 'variavel', essencial: true },
    { nome: 'Transporte', tipo: 'saida', grupo: 'variavel', essencial: true },
    { nome: 'Compras', tipo: 'saida', grupo: 'variavel', essencial: false },
    { nome: 'Assinaturas', tipo: 'saida', grupo: 'variavel', essencial: false },
    // ── INVESTIMENTOS ──
    { nome: 'Aporte investimento', tipo: 'saida', grupo: 'investimento', essencial: true },
    { nome: 'Reserva', tipo: 'saida', grupo: 'investimento', essencial: true },
    // ── DIVERSOS (lazer, família) ──
    { nome: 'Lazer', tipo: 'saida', grupo: 'diversos', essencial: false },
    { nome: 'Restaurantes', tipo: 'saida', grupo: 'diversos', essencial: false },
    { nome: 'Família', tipo: 'saida', grupo: 'diversos', essencial: false },
    { nome: 'Viagens', tipo: 'saida', grupo: 'diversos', essencial: false },
    { nome: 'Presentes', tipo: 'saida', grupo: 'diversos', essencial: false },
    { nome: 'Outros', tipo: 'saida', grupo: 'diversos', essencial: false },
  ];

  // rótulos e cores dos grupos de saída (para previsão/orçamento)
  const GRUPOS = {
    fixa:         { lbl: 'Despesas fixas',     cor: '#2563eb' },
    variavel:     { lbl: 'Despesas variáveis', cor: '#0891b2' },
    investimento: { lbl: 'Investimentos',      cor: '#16a34a' },
    diversos:     { lbl: 'Diversos / lazer',   cor: '#f59e0b' },
  };

  // helpers de categoria
  function catsDoTipo(tipo) { return (_data.categorias || []).filter(c => (c.tipo || 'saida') === tipo); }
  function catObj(nome) { return (_data.categorias || []).find(c => c.nome === nome); }
  function grupoDaCat(nome) { const c = catObj(nome); return c?.grupo || 'diversos'; }

  // ── Cripto ──────────────────────────────────────────────────────────────
  function deriveKey(senha, salt) {
    // scrypt: N=2^15 (custo alto, ~100ms) — bom contra brute force.
    // maxmem precisa ser > 128*N*r (≈33.5MB aqui), senão o Node estoura o
    // limite padrão de 32MB e lança ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
    return crypto.scryptSync(Buffer.from(senha, 'utf8'), salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  }

  function encrypt(dataObj, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plain = Buffer.from(JSON.stringify(dataObj), 'utf8');
    const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: ct.toString('base64') };
  }

  function decrypt(blob, key) {
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const ct = Buffer.from(blob.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  }

  function fileExists() { try { return fs.existsSync(FILE); } catch { return false; } }

  // ── Envelope de chave (key-wrapping) ─────────────────────────────────────
  // O cofre é cifrado por uma dataKey aleatória. Essa dataKey é "embrulhada"
  // duas vezes: pela SENHA e pelas RESPOSTAS de segurança. Assim dá pra
  // redefinir a senha respondendo as perguntas, sem nunca guardar a senha em
  // si e sem re-cifrar todos os dados.
  const MAGIC2 = 'NXFIN2';

  function wrapKey(rawKey, kek) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', kek, iv);
    const ct = Buffer.concat([c.update(rawKey), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: ct.toString('base64') };
  }
  function unwrapKey(blob, kek) {
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const ct = Buffer.from(blob.data, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', kek, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]); // lança se kek errada
  }
  // normaliza resposta: sem acento, minúscula, espaços colapsados → tolerante a digitação
  function normResp(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' '); }
  function recoverySecret(respostas) { return respostas.map(normResp).join(''); } // ordem importa

  let _meta = null;       // {saltP,saltR,perguntas,hint,wrapP,wrapR}  (NXFIN2)
  let _legacySalt = null; // só p/ arquivos antigos NXFIN1

  function ensureFields() {
    if (!_data.categorias || !_data.categorias.length) _data.categorias = DEFAULT_CATS.slice();
    // migração: categorias antigas sem tipo/grupo
    _data.categorias.forEach(c => { if (!c.tipo) c.tipo = 'saida'; if (c.tipo === 'saida' && !c.grupo) c.grupo = c.essencial ? 'fixa' : 'diversos'; });
    if (!_data.cotas) _data.cotas = [];
    if (!_data.dividas) _data.dividas = [];
    if (!_data.metas) _data.metas = [];
    if (!_data.orcamento) _data.orcamento = {};
    if (!_data.rendasFixas) _data.rendasFixas = [];
    if (!_data.alocacao) _data.alocacao = { pessoal: { fixa: 50, variavel: 15, investimento: 20, diversos: 15 }, a2z: { fixa: 60, variavel: 20, investimento: 15, diversos: 5 } };
    if (!_data.config) _data.config = {};
    if (_data.config.reservaMeses == null) _data.config.reservaMeses = 6;
  }

  // soma da renda fixa pré-setada do escopo
  function rendaFixaTotal() {
    return (_data.rendasFixas || []).filter(r => r.escopo === _escopo).reduce((a, r) => a + (Number(r.valor) || 0), 0);
  }
  // renda mensal de referência: maior entre renda fixa setada, entradas recorrentes e média de entradas
  function rendaReferencia() {
    const fixa = rendaFixaTotal();
    const recorr = lancEscopo().filter(l => l.tipo === 'entrada' && l.recorrente).reduce((a, l) => a + (Number(l.valor) || 0), 0);
    const ms = lastNMonths(3);
    const med = ms.reduce((a, k) => a + totaisMes(k).entradas, 0) / 3;
    return Math.max(fixa, recorr, med);
  }

  function saveData() {
    if (!_key || !_data) return;
    try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); } catch {}
    const vault = encrypt(_data, _key);
    let out;
    if (_meta) {
      out = { magic: MAGIC2, kdf: 'scrypt', saltP: _meta.saltP, saltR: _meta.saltR, perguntas: _meta.perguntas, hint: _meta.hint || null, wrapP: _meta.wrapP, wrapR: _meta.wrapR, vault };
    } else {
      out = { magic: MAGIC, kdf: 'scrypt', salt: _legacySalt, ...vault }; // legado NXFIN1
    }
    fs.writeFileSync(FILE, JSON.stringify(out));
  }

  // Cria o cofre novo já com pergunta de segurança (2 perguntas + 2 respostas).
  function createVault(senha, perguntas, respostas, hint) {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const dataKey = crypto.randomBytes(32);
    const saltP = crypto.randomBytes(16);
    const saltR = crypto.randomBytes(16);
    const wrapP = wrapKey(dataKey, deriveKey(senha, saltP));
    const wrapR = wrapKey(dataKey, deriveKey(recoverySecret(respostas), saltR));
    _key = dataKey;
    _meta = {
      saltP: saltP.toString('base64'), saltR: saltR.toString('base64'),
      perguntas: perguntas.slice(0, 2), hint: hint || null, wrapP, wrapR,
    };
    _legacySalt = null;
    _data = emptyData();
    saveData();
  }

  function unlock(senha) {
    const raw = readFileBlobAny();
    if (raw.magic === MAGIC2) {
      const pk = deriveKey(senha, Buffer.from(raw.saltP, 'base64'));
      const dataKey = unwrapKey(raw.wrapP, pk); // lança se senha errada
      _key = dataKey;
      _meta = { saltP: raw.saltP, saltR: raw.saltR, perguntas: raw.perguntas || [], hint: raw.hint || null, wrapP: raw.wrapP, wrapR: raw.wrapR };
      _legacySalt = null;
      _data = decrypt(raw.vault, dataKey);
    } else {
      // legado NXFIN1 (cofre sem pergunta de segurança)
      const key = deriveKey(senha, Buffer.from(raw.salt, 'base64'));
      _key = key; _meta = null; _legacySalt = raw.salt;
      _data = decrypt(raw, key);
    }
    ensureFields();
  }

  // Redefine a senha respondendo as perguntas de segurança (na ordem certa).
  function resetComRespostas(respostas, novaSenha) {
    const raw = readFileBlobAny();
    if (raw.magic !== MAGIC2) throw new Error('Este cofre não tem pergunta de segurança configurada.');
    const rk = deriveKey(recoverySecret(respostas), Buffer.from(raw.saltR, 'base64'));
    const dataKey = unwrapKey(raw.wrapR, rk); // lança se respostas erradas
    const saltP = crypto.randomBytes(16);
    const wrapP = wrapKey(dataKey, deriveKey(novaSenha, saltP));
    _key = dataKey;
    _meta = { saltP: saltP.toString('base64'), saltR: raw.saltR, perguntas: raw.perguntas, hint: raw.hint || null, wrapP, wrapR: raw.wrapR };
    _legacySalt = null;
    _data = decrypt(raw.vault, dataKey);
    ensureFields();
    saveData();
  }

  // lê o arquivo aceitando NXFIN1 ou NXFIN2
  function readFileBlobAny() {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw.magic !== MAGIC && raw.magic !== MAGIC2) throw new Error('Arquivo financeiro inválido');
    return raw;
  }
  // o cofre tem pergunta de segurança? (NXFIN2)
  function temPergunta() { try { return readFileBlobAny().magic === MAGIC2; } catch { return false; } }
  function perguntasDoArquivo() { try { return readFileBlobAny().perguntas || []; } catch { return []; } }

  function lock() { _key = null; _data = null; _meta = null; render(); }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const toast = (m, t) => { try { (t === 'error' ? window.toastError : window.toastSuccess || window.toast)?.(m); } catch {} };
  const ymd = (d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 10);
  const monthKey = (d) => ymd(d).slice(0, 7);
  const todayStr = () => ymd(new Date());
  const curMonth = () => monthKey(new Date());

  function addMonths(date, n) { const d = new Date(date); d.setMonth(d.getMonth() + n); return d; }
  function lastNMonths(n) {
    const out = [];
    const base = new Date(); base.setDate(1);
    for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(base, -i)));
    return out;
  }

  // filtra lançamentos por escopo atual
  const lancEscopo = () => (_data.lancamentos || []).filter(l => l.escopo === _escopo);

  // ════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════════════
  function root() { return document.getElementById('fin-root'); }

  function render() {
    const el = root();
    if (!el) return;
    // Quem não é o Lucas (ex: Matheus) só tem A2Z — nunca a parte pessoal.
    if (!ehLucas() && _escopo === 'pessoal') _escopo = 'a2z';
    if (!_data) { el.innerHTML = renderLock(); wireLock(); return; }
    el.innerHTML = renderShell();
    wireShell();
    renderView();
  }

  // ── Tela de bloqueio ─────────────────────────────────────────────────────
  // Sugestões de perguntas de segurança (o usuário pode escrever a própria).
  const PERGUNTAS_SUGERIDAS = [
    'Nome do seu primeiro animal de estimação?',
    'Cidade onde você nasceu?',
    'Nome de solteira da sua mãe?',
    'Nome da sua primeira escola?',
    'Modelo do seu primeiro carro?',
    'Nome do seu melhor amigo de infância?',
    'Rua onde você morava na infância?',
  ];
  let _lockMode = 'login'; // 'login' | 'reset'

  const lockInput = (id, ph, type) => `<input id="${id}" type="${type || 'text'}" autocomplete="off" placeholder="${ph}" style="width:100%;padding:10px 12px;font-family:inherit;font-size:14px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);outline:none;box-sizing:border-box"/>`;
  const lockLbl = (t) => `<label style="display:block;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin:12px 0 6px">${t}</label>`;
  const selPergunta = (id) => `<select id="${id}" style="width:100%;padding:10px 12px;font-family:inherit;font-size:13px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);outline:none;box-sizing:border-box">${PERGUNTAS_SUGERIDAS.map(q => `<option>${esc(q)}</option>`).join('')}<option value="__custom__">✏️ Escrever minha própria pergunta…</option></select>`;

  function lockShell(inner) {
    return `
    <div style="max-width:440px;margin:50px auto;padding:0 20px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow-sm);overflow:hidden">
        <div style="background:var(--gray-900);padding:26px 24px;text-align:center">
          <div style="width:50px;height:50px;margin:0 auto 10px;border-radius:14px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </div>
          <div style="color:#fff;font-size:18px;font-weight:700">Financeiro</div>
          <div style="color:rgba(255,255,255,.6);font-size:12px;margin-top:3px">Área privada · dados criptografados neste PC</div>
        </div>
        <div style="padding:22px 24px 24px">${inner}</div>
      </div>
    </div>`;
  }

  function renderLock() {
    const first = !fileExists();
    if (_lockMode === 'reset') return lockShell(renderReset());
    if (first) return lockShell(renderFirstRun());
    return lockShell(renderLogin());
  }

  function renderLogin() {
    const hint = (() => { try { return readFileBlobAny().hint; } catch { return null; } })();
    return `
      ${lockLbl('Senha')}
      ${lockInput('fin-pass', 'Digite sua senha', 'password')}
      ${hint ? `<div style="font-size:11px;color:var(--text3);margin-top:6px">💡 Dica: ${esc(hint)}</div>` : ''}
      <div id="fin-lock-err" style="color:var(--red);font-size:12px;margin-top:10px;min-height:16px"></div>
      <button id="fin-unlock-btn" style="width:100%;margin-top:4px;background:var(--gray-900);color:#fff;border:none;border-radius:8px;padding:12px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">Desbloquear</button>
      ${temPergunta() ? `<button id="fin-forgot" style="width:100%;margin-top:10px;background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline">Esqueci a senha</button>` : ''}
    `;
  }

  function renderFirstRun() {
    return `
      <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:8px">Primeiro acesso. Crie uma senha e <strong>duas perguntas de segurança</strong> — elas permitem redefinir a senha se você esquecer.</div>
      ${lockLbl('Senha')}${lockInput('fin-pass', 'Crie uma senha forte', 'password')}
      ${lockLbl('Confirmar senha')}${lockInput('fin-pass2', 'Repita a senha', 'password')}
      ${lockLbl('Dica da senha (opcional)')}${lockInput('fin-hint', 'Algo que só você entende')}
      <div style="border-top:1px solid var(--border);margin:18px 0 4px"></div>
      <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:2px">Perguntas de segurança</div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px">Respostas não diferenciam maiúsculas nem acentos. A ordem importa.</div>
      ${lockLbl('Pergunta 1')}${selPergunta('fin-q1')}<div id="fin-q1c" style="margin-top:6px;display:none">${lockInput('fin-q1custom', 'Escreva sua pergunta 1')}</div>
      ${lockLbl('Resposta 1')}${lockInput('fin-a1', 'Resposta da pergunta 1')}
      ${lockLbl('Pergunta 2')}${selPergunta('fin-q2')}<div id="fin-q2c" style="margin-top:6px;display:none">${lockInput('fin-q2custom', 'Escreva sua pergunta 2')}</div>
      ${lockLbl('Resposta 2')}${lockInput('fin-a2', 'Resposta da pergunta 2')}
      <div id="fin-lock-err" style="color:var(--red);font-size:12px;margin-top:12px;min-height:16px"></div>
      <button id="fin-unlock-btn" style="width:100%;margin-top:4px;background:var(--gray-900);color:#fff;border:none;border-radius:8px;padding:12px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">Criar e entrar</button>
    `;
  }

  function renderReset() {
    const qs = perguntasDoArquivo();
    return `
      <div style="font-size:13px;color:var(--text2);line-height:1.6;margin-bottom:6px">Responda as perguntas de segurança <strong>na ordem</strong> para criar uma nova senha.</div>
      ${lockLbl('Pergunta 1')}<div style="font-size:13px;color:var(--text);margin-bottom:6px">${esc(qs[0] || '—')}</div>${lockInput('fin-r1', 'Resposta 1')}
      ${lockLbl('Pergunta 2')}<div style="font-size:13px;color:var(--text);margin-bottom:6px">${esc(qs[1] || '—')}</div>${lockInput('fin-r2', 'Resposta 2')}
      ${lockLbl('Nova senha')}${lockInput('fin-np', 'Crie a nova senha', 'password')}
      ${lockLbl('Confirmar nova senha')}${lockInput('fin-np2', 'Repita a nova senha', 'password')}
      <div id="fin-lock-err" style="color:var(--red);font-size:12px;margin-top:12px;min-height:16px"></div>
      <button id="fin-reset-btn" style="width:100%;margin-top:4px;background:var(--gray-900);color:#fff;border:none;border-radius:8px;padding:12px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer">Redefinir senha</button>
      <button id="fin-back-login" style="width:100%;margin-top:10px;background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;text-decoration:underline">Voltar ao login</button>
    `;
  }

  function wireLock() {
    const first = !fileExists();
    const errEl = () => document.getElementById('fin-lock-err');
    const setErr = (m) => { const e = errEl(); if (e) e.textContent = m || ''; };

    // toggle de pergunta custom no first-run
    ['1', '2'].forEach(n => {
      const sel = document.getElementById('fin-q' + n);
      if (sel) sel.addEventListener('change', () => {
        document.getElementById('fin-q' + n + 'c').style.display = sel.value === '__custom__' ? '' : 'none';
      });
    });
    const pergunta = (n) => {
      const sel = document.getElementById('fin-q' + n);
      if (!sel) return '';
      return sel.value === '__custom__' ? (document.getElementById('fin-q' + n + 'custom').value.trim()) : sel.value;
    };

    if (_lockMode === 'reset') {
      const btn = document.getElementById('fin-reset-btn');
      const go = () => {
        setErr('');
        const r1 = document.getElementById('fin-r1').value;
        const r2 = document.getElementById('fin-r2').value;
        const np = document.getElementById('fin-np').value;
        const np2 = document.getElementById('fin-np2').value;
        if (!r1 || !r2) { setErr('Responda as duas perguntas.'); return; }
        if (!np || np.length < 4) { setErr('Nova senha muito curta (mín. 4).'); return; }
        if (np !== np2) { setErr('As senhas não conferem.'); return; }
        try { resetComRespostas([r1, r2], np); _lockMode = 'login'; render(); }
        catch (e) { setErr('Respostas incorretas. Verifique e tente de novo.'); }
      };
      btn.addEventListener('click', go);
      document.getElementById('fin-back-login').addEventListener('click', () => { _lockMode = 'login'; render(); });
      setTimeout(() => document.getElementById('fin-r1')?.focus(), 50);
      return;
    }

    const btn = document.getElementById('fin-unlock-btn');
    const pass = document.getElementById('fin-pass');
    const go = () => {
      setErr('');
      const senha = pass.value;
      if (!senha || senha.length < 4) { setErr('Senha muito curta (mín. 4).'); return; }
      try {
        if (first) {
          const p2 = document.getElementById('fin-pass2').value;
          if (senha !== p2) { setErr('As senhas não conferem.'); return; }
          const q1 = pergunta('1'), q2 = pergunta('2');
          const a1 = document.getElementById('fin-a1').value.trim();
          const a2 = document.getElementById('fin-a2').value.trim();
          if (!q1 || !q2) { setErr('Defina as duas perguntas de segurança.'); return; }
          if (normResp(q1) === normResp(q2)) { setErr('Use duas perguntas diferentes.'); return; }
          if (!a1 || !a2) { setErr('Responda as duas perguntas de segurança.'); return; }
          const hint = document.getElementById('fin-hint').value.trim() || null;
          createVault(senha, [q1, q2], [a1, a2], hint);
        } else {
          unlock(senha);
        }
        render();
      } catch (e) {
        setErr(first ? ('Erro ao criar: ' + e.message) : 'Senha incorreta.');
      }
    };
    btn.addEventListener('click', go);
    pass.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const forgot = document.getElementById('fin-forgot');
    if (forgot) forgot.addEventListener('click', () => { _lockMode = 'reset'; render(); });
    setTimeout(() => pass.focus(), 50);
  }

  // ── Shell (header + abas internas) ───────────────────────────────────────
  function renderShell() {
    const views = [
      ['dashboard', 'Visão geral'], ['lancamentos', 'Lançamentos'], ['orcamento', 'Orçamento'],
      ['contas', 'Contas'], ['dividas', 'Dívidas'], ['cotas', 'Investimentos'], ['metas', 'Metas'],
      ['previsao', 'Previsão'], ['analise', 'Análise'], ['config', 'Configurar'],
    ];
    return `
    <div style="max-width:1200px;margin:0 auto;padding:24px 20px 60px">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;flex-wrap:wrap">
        <div>
          <h1 style="font-size:24px;font-weight:700;letter-spacing:-.3px;color:var(--text);margin:0">Financeiro</h1>
          <div style="font-size:12px;color:var(--text3);margin-top:2px">Privado · criptografado neste PC</div>
        </div>
        <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
          <div style="display:flex;border:1.5px solid var(--border);border-radius:8px;overflow:hidden">
            ${ehLucas() ? `<button class="fin-escopo" data-escopo="pessoal" style="${escBtn('pessoal')}">Pessoal</button>` : ''}
            <button class="fin-escopo" data-escopo="a2z" style="${escBtn('a2z')}">A2Z (PJ)</button>
          </div>
          <button id="fin-lock" title="Bloquear" style="background:var(--surface);border:1.5px solid var(--border);border-radius:8px;padding:8px 10px;cursor:pointer;color:var(--text2);display:flex;align-items:center;gap:6px;font-size:12px;font-family:inherit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Bloquear
          </button>
        </div>
      </div>
      <div style="display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:20px;overflow-x:auto">
        ${views.map(([k, lbl]) => `<button class="fin-tab" data-view="${k}" style="${tabBtn(k)}">${lbl}</button>`).join('')}
      </div>
      <div id="fin-view"></div>
    </div>`;
  }

  function escBtn(e) {
    const on = _escopo === e;
    return `background:${on ? 'var(--gray-900)' : 'var(--surface)'};color:${on ? '#fff' : 'var(--text2)'};border:none;padding:8px 16px;font-family:inherit;font-size:12px;font-weight:600;cursor:pointer`;
  }
  function tabBtn(k) {
    const on = _curView === k;
    return `background:none;border:none;border-bottom:2.5px solid ${on ? 'var(--gray-900)' : 'transparent'};color:${on ? 'var(--text)' : 'var(--text3)'};padding:10px 16px;font-family:inherit;font-size:13px;font-weight:${on ? 600 : 500};cursor:pointer;white-space:nowrap;margin-bottom:-1px`;
  }

  function wireShell() {
    document.querySelectorAll('.fin-tab').forEach(b => b.addEventListener('click', () => { _curView = b.dataset.view; render(); }));
    document.querySelectorAll('.fin-escopo').forEach(b => b.addEventListener('click', () => { _escopo = b.dataset.escopo; render(); }));
    document.getElementById('fin-lock').addEventListener('click', lock);
  }

  function renderView() {
    const el = document.getElementById('fin-view');
    if (!el) return;
    const fn = {
      dashboard: viewDashboard, lancamentos: viewLancamentos, orcamento: viewOrcamento, contas: viewContas,
      dividas: viewDividas, cotas: viewCotas, metas: viewMetas, previsao: viewPrevisao, analise: viewAnalise,
      config: viewConfig,
    }[_curView] || viewDashboard;
    fn(el);
  }

  // ── Card helper ──────────────────────────────────────────────────────────
  function kpi(label, val, sub, color) {
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow-sm)">
      <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">${label}</div>
      <div style="font-size:22px;font-weight:800;color:${color || 'var(--text)'};margin-top:6px;font-family:'DM Mono',monospace">${val}</div>
      ${sub ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">${sub}</div>` : ''}
    </div>`;
  }

  // ── Cálculos compartilhados ───────────────────────────────────────────────
  function saldoContas() {
    const contas = (_data.contas || []).filter(c => c.escopo === _escopo);
    const map = {};
    contas.forEach(c => { map[c.id] = Number(c.saldoInicial) || 0; });
    lancEscopo().forEach(l => {
      if (l.status === 'pendente') return; // só realizado conta no saldo
      if (l.contaId && map[l.contaId] != null) {
        map[l.contaId] += (l.tipo === 'entrada' ? 1 : -1) * (Number(l.valor) || 0);
      }
    });
    return { contas, map, total: Object.values(map).reduce((a, b) => a + b, 0) };
  }

  function totaisMes(mk) {
    let entradas = 0, saidas = 0;
    lancEscopo().forEach(l => {
      if (monthKey(l.data) !== mk) return;
      if (l.status === 'pendente') return;
      if (l.tipo === 'entrada') entradas += Number(l.valor) || 0;
      else saidas += Number(l.valor) || 0;
    });
    return { entradas, saidas, saldo: entradas - saidas };
  }

  function gastosPorCategoria(mk) {
    const out = {};
    lancEscopo().forEach(l => {
      if (l.tipo !== 'saida' || l.status === 'pendente') return;
      if (mk && monthKey(l.data) !== mk) return;
      const c = l.categoria || 'Outros';
      out[c] = (out[c] || 0) + (Number(l.valor) || 0);
    });
    return out;
  }

  function isEssencial(cat) {
    const c = (_data.categorias || []).find(x => x.nome === cat);
    return c ? !!c.essencial : false;
  }

  // média de saídas dos últimos N meses (default 3) — base p/ reserva e previsão
  function mediaGastoMensal(n) {
    n = n || 3;
    const ms = lastNMonths(n);
    const tot = ms.reduce((a, k) => a + totaisMes(k).saidas, 0);
    return tot / n;
  }

  // patrimônio líquido do escopo
  function patrimonioLiquido() {
    const sc = saldoContas();
    const cotas = (_data.cotas || []).filter(c => c.escopo === _escopo).reduce((a, c) => a + (Number(c.valorAtual) || 0), 0);
    const div = (_data.dividas || []).filter(d => d.escopo === _escopo).reduce((a, d) => a + (Number(d.saldoDevedor) || 0), 0);
    return { saldo: sc.total, cotas, dividas: div, liquido: sc.total + cotas - div };
  }

  // ── Score de saúde financeira (0–100) ────────────────────────────────────
  function computeSaude() {
    const mk = curMonth();
    const m = totaisMes(mk);
    const partes = [];
    let score = 0;

    // 1) Taxa de poupança (0–30) — usa renda fixa cadastrada como referência
    const renda = m.entradas || rendaReferencia();
    const taxa = renda > 0 ? m.saldo / renda : 0;
    const pPoup = Math.max(0, Math.min(30, Math.round((taxa / 0.2) * 30)));
    score += pPoup;
    partes.push({ nome: 'Poupança', pts: pPoup, max: 30, txt: renda > 0 ? pct(taxa) + ' da renda guardada' : 'sem renda lançada' });

    // 2) Comprometimento com dívida (0–25)
    const parc = (_data.dividas || []).filter(d => d.escopo === _escopo).reduce((a, d) => a + (Number(d.parcela) || 0), 0);
    const comp = renda > 0 ? parc / renda : 0;
    const pDiv = parc === 0 ? 25 : Math.max(0, Math.min(25, Math.round((1 - comp / 0.4) * 25)));
    score += pDiv;
    partes.push({ nome: 'Dívidas', pts: pDiv, max: 25, txt: parc === 0 ? 'sem dívidas' : pct(comp) + ' da renda em parcelas' });

    // 3) Reserva de emergência (0–25)
    const pl = patrimonioLiquido();
    const gastoMes = mediaGastoMensal(3) || m.saidas || 1;
    const mesesCobre = (pl.saldo + pl.cotas) / gastoMes;
    const alvoMeses = _data.config.reservaMeses || 6;
    const pRes = Math.max(0, Math.min(25, Math.round((mesesCobre / alvoMeses) * 25)));
    score += pRes;
    partes.push({ nome: 'Reserva', pts: pRes, max: 25, txt: mesesCobre.toFixed(1) + ' meses cobertos (alvo ' + alvoMeses + ')' });

    // 4) Disciplina de gastos / supérfluos (0–20)
    const cats = gastosPorCategoria(mk);
    const totG = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
    const superf = Object.entries(cats).filter(([c]) => !isEssencial(c)).reduce((a, [, v]) => a + v, 0);
    const ratioS = superf / totG;
    const pSup = Math.max(0, Math.min(20, Math.round((1 - ratioS / 0.3) * 20)));
    score += pSup;
    partes.push({ nome: 'Gastos', pts: pSup, max: 20, txt: pct(ratioS) + ' em supérfluos' });

    score = Math.max(0, Math.min(100, score));
    const nivel = score >= 80 ? { lbl: 'Excelente', cor: '#16a34a' }
      : score >= 60 ? { lbl: 'Boa', cor: '#65a30d' }
      : score >= 40 ? { lbl: 'Regular', cor: '#d97706' }
      : { lbl: 'Atenção', cor: '#dc2626' };
    return { score, partes, nivel, mesesCobre, gastoMes };
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: DASHBOARD
  // ════════════════════════════════════════════════════════════════════════
  function viewDashboard(el) {
    const mk = curMonth();
    const sc = saldoContas();
    const m = totaisMes(mk);
    const dividas = (_data.dividas || []).filter(d => d.escopo === _escopo);
    const saldoDevedor = dividas.reduce((a, d) => a + (Number(d.saldoDevedor) || 0), 0);
    const cotas = (_data.cotas || []).filter(c => c.escopo === _escopo);
    const patrimCotas = cotas.reduce((a, c) => a + (Number(c.valorAtual) || 0), 0);
    const patrimonio = sc.total + patrimCotas - saldoDevedor;
    const taxaPoup = m.entradas > 0 ? (m.saldo / m.entradas) : 0;

    // série dos últimos 6 meses
    const meses = lastNMonths(6);
    const serie = meses.map(k => totaisMes(k));
    const maxV = Math.max(1, ...serie.map(s => Math.max(s.entradas, s.saidas)));

    const cats = gastosPorCategoria(mk);
    const topCats = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totGasto = Object.values(cats).reduce((a, b) => a + b, 0) || 1;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:22px">
        ${kpi('Patrimônio líquido', money(patrimonio), 'contas + investimentos − dívidas', patrimonio >= 0 ? 'var(--text)' : 'var(--red)')}
        ${kpi('Saldo em contas', money(sc.total), sc.contas.length + ' conta(s)')}
        ${kpi('Entradas do mês', money(m.entradas), nomeMes(mk), '#16a34a')}
        ${kpi('Saídas do mês', money(m.saidas), nomeMes(mk), '#dc2626')}
        ${kpi('Resultado do mês', money(m.saldo), 'taxa de poupança ' + pct(taxaPoup), m.saldo >= 0 ? '#16a34a' : '#dc2626')}
        ${kpi('Dívidas', money(saldoDevedor), dividas.length + ' em aberto', saldoDevedor > 0 ? '#dc2626' : 'var(--text3)')}
      </div>

      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:20px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm)">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:16px">Entradas × Saídas (6 meses)</div>
          <div style="display:flex;align-items:flex-end;gap:14px;height:160px;padding-top:10px">
            ${serie.map((s, i) => {
              const hE = Math.round((s.entradas / maxV) * 130);
              const hS = Math.round((s.saidas / maxV) * 130);
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
                <div style="display:flex;align-items:flex-end;gap:3px;height:130px">
                  <div title="Entradas: ${money(s.entradas)}" style="width:14px;height:${hE}px;background:#16a34a;border-radius:3px 3px 0 0"></div>
                  <div title="Saídas: ${money(s.saidas)}" style="width:14px;height:${hS}px;background:#dc2626;border-radius:3px 3px 0 0"></div>
                </div>
                <div style="font-size:9px;color:var(--text3);font-family:'DM Mono',monospace">${meses[i].slice(5)}/${meses[i].slice(2, 4)}</div>
              </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:var(--text3)">
            <span><span style="display:inline-block;width:10px;height:10px;background:#16a34a;border-radius:2px;vertical-align:middle"></span> Entradas</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#dc2626;border-radius:2px;vertical-align:middle"></span> Saídas</span>
          </div>
        </div>

        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm)">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px">Onde vai o dinheiro · ${nomeMes(mk)}</div>
          ${topCats.length ? topCats.map(([cat, v]) => {
            const p = v / totGasto;
            return `<div style="margin-bottom:11px">
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                <span style="color:var(--text2)">${esc(cat)} ${isEssencial(cat) ? '' : '<span style="font-size:9px;color:#d97706">• supérfluo</span>'}</span>
                <span style="font-family:'DM Mono',monospace;color:var(--text)">${money(v)}</span>
              </div>
              <div style="height:7px;background:var(--surface2);border-radius:4px;overflow:hidden">
                <div style="height:100%;width:${(p * 100).toFixed(0)}%;background:${isEssencial(cat) ? 'var(--accent)' : '#f59e0b'};border-radius:4px"></div>
              </div>
            </div>`;
          }).join('') : `<div style="color:var(--text3);font-size:12px;padding:20px 0;text-align:center">Sem gastos lançados neste mês.</div>`}
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="fin-act" data-act="add-lanc" style="${primBtn()}">+ Novo lançamento</button>
        <button class="fin-act" data-act="goto-previsao" style="${ghostBtn()}">Ver previsão</button>
        <button class="fin-act" data-act="goto-analise" style="${ghostBtn()}">Ver análise →</button>
      </div>
    `;
    el.querySelectorAll('.fin-act').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'add-lanc') openLancModal();
      if (a === 'goto-previsao') { _curView = 'previsao'; render(); }
      if (a === 'goto-analise') { _curView = 'analise'; render(); }
    }));
  }

  function nomeMes(mk) {
    const [y, m] = mk.split('-');
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return nomes[(+m) - 1] + '/' + y;
  }
  function primBtn() { return 'background:var(--gray-900);color:#fff;border:none;border-radius:8px;padding:10px 16px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer'; }
  function ghostBtn() { return 'background:var(--surface);color:var(--text2);border:1.5px solid var(--border);border-radius:8px;padding:10px 16px;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer'; }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: LANÇAMENTOS
  // ════════════════════════════════════════════════════════════════════════
  function viewLancamentos(el) {
    const lancs = lancEscopo().slice().sort((a, b) => (b.data || '').localeCompare(a.data || ''));
    const contas = (_data.contas || []).filter(c => c.escopo === _escopo);
    const contaNome = (id) => (contas.find(c => c.id === id) || {}).nome || '—';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Lançamentos — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
        <button id="fin-add-lanc" style="margin-left:auto;${primBtn()}">+ Novo</button>
      </div>
      ${lancs.length ? `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="background:var(--surface2)"><tr>
            ${['Data', 'Descrição', 'Categoria', 'Conta', 'Status', 'Valor', ''].map(h => `<th style="padding:9px 12px;text-align:${h === 'Valor' ? 'right' : 'left'};font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px">${h}</th>`).join('')}
          </tr></thead><tbody>
          ${lancs.map(l => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:9px 12px;font-family:'DM Mono',monospace;color:var(--text2);white-space:nowrap">${l.data ? l.data.split('-').reverse().join('/') : '—'}</td>
            <td style="padding:9px 12px;color:var(--text)">${esc(l.descricao)}${l.recorrente ? ' <span style="font-size:9px;color:var(--accent);border:1px solid var(--accent);border-radius:4px;padding:0 4px">recorrente</span>' : ''}</td>
            <td style="padding:9px 12px;color:var(--text2)">${esc(l.categoria || '—')}</td>
            <td style="padding:9px 12px;color:var(--text2)">${esc(contaNome(l.contaId))}</td>
            <td style="padding:9px 12px">${l.status === 'pendente' ? '<span style="font-size:10px;font-weight:700;color:#d97706;background:#fffbeb;padding:2px 7px;border-radius:8px">pendente</span>' : '<span style="font-size:10px;font-weight:700;color:#16a34a;background:#f0fdf4;padding:2px 7px;border-radius:8px">pago</span>'}</td>
            <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${l.tipo === 'entrada' ? '#16a34a' : '#dc2626'}">${l.tipo === 'entrada' ? '+' : '−'} ${money(l.valor)}</td>
            <td style="padding:9px 12px;text-align:right;white-space:nowrap">
              ${l.status === 'pendente' ? `<button class="fin-pay" data-id="${l.id}" title="Marcar pago" style="background:none;border:1px solid #86efac;color:#16a34a;border-radius:4px;padding:3px 7px;font-size:10px;cursor:pointer;margin-right:3px">✓</button>` : ''}
              <button class="fin-edit" data-id="${l.id}" style="background:none;border:1px solid var(--border);color:var(--text2);border-radius:4px;padding:3px 7px;font-size:10px;cursor:pointer;margin-right:3px">editar</button>
              <button class="fin-del" data-id="${l.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:3px 7px;font-size:10px;cursor:pointer">✕</button>
            </td>
          </tr>`).join('')}
        </tbody></table>
      </div>` : emptyBox('Nenhum lançamento. Clique em “+ Novo”.')}
    `;
    document.getElementById('fin-add-lanc').addEventListener('click', () => openLancModal());
    el.querySelectorAll('.fin-edit').forEach(b => b.addEventListener('click', () => openLancModal(b.dataset.id)));
    el.querySelectorAll('.fin-pay').forEach(b => b.addEventListener('click', () => {
      const l = _data.lancamentos.find(x => x.id === b.dataset.id);
      if (l) { l.status = 'pago'; saveData(); render(); }
    }));
    el.querySelectorAll('.fin-del').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir este lançamento?'))) return;
      _data.lancamentos = _data.lancamentos.filter(x => x.id !== b.dataset.id);
      saveData(); render();
    }));
  }

  // monta as <option> de categoria para um tipo, marcando a selecionada
  function optsCategoria(tipo, selecionada) {
    const lista = catsDoTipo(tipo);
    return lista.map(c => `<option ${selecionada === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')
      + '<option value="__nova__">＋ Nova categoria…</option>';
  }

  function openLancModal(id) {
    const l = id ? _data.lancamentos.find(x => x.id === id) : null;
    const contas = (_data.contas || []).filter(c => c.escopo === _escopo);
    const tipoIni = l?.tipo === 'entrada' ? 'entrada' : 'saida';
    modal(`${l ? 'Editar' : 'Novo'} lançamento`, `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="grid-column:1/-1">${fLabel('Descrição')}<input id="m-desc" value="${esc(l?.descricao || '')}" style="${inp()}"/></div>
        <div>${fLabel('Tipo')}<select id="m-tipo" style="${inp()}"><option value="saida" ${tipoIni !== 'entrada' ? 'selected' : ''}>Saída</option><option value="entrada" ${tipoIni === 'entrada' ? 'selected' : ''}>Entrada</option></select></div>
        <div>${fLabel('Valor (R$)')}<input id="m-valor" type="text" value="${l ? l.valor : ''}" placeholder="0,00" style="${inp()}"/></div>
        <div>${fLabel('Data')}<input id="m-data" type="date" value="${l?.data || todayStr()}" style="${inp()}"/></div>
        <div>${fLabel('Categoria')}<select id="m-cat" style="${inp()}">${optsCategoria(tipoIni, l?.categoria)}</select></div>
        <div>${fLabel('Conta')}<select id="m-conta" style="${inp()}"><option value="">— sem conta —</option>${contas.map(c => `<option value="${c.id}" ${l?.contaId === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
        <div>${fLabel('Status')}<select id="m-status" style="${inp()}"><option value="pago" ${l?.status !== 'pendente' ? 'selected' : ''}>Pago / realizado</option><option value="pendente" ${l?.status === 'pendente' ? 'selected' : ''}>Pendente (a pagar/receber)</option></select></div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:2px">
          <input type="checkbox" id="m-rec" ${l?.recorrente ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer"/>
          <label for="m-rec" style="font-size:12px;color:var(--text2);cursor:pointer">Recorrente (mensal) — usado na previsão de renda/despesa fixa</label>
        </div>
      </div>
    `, () => {
      const valor = parseFloat(String(document.getElementById('m-valor').value).replace(/\./g, '').replace(',', '.')) || 0;
      const desc = document.getElementById('m-desc').value.trim();
      if (!desc) { toast('Informe a descrição', 'error'); return false; }
      if (valor <= 0) { toast('Valor inválido', 'error'); return false; }
      const cat = document.getElementById('m-cat').value;
      if (cat === '__nova__') { toast('Escolha ou crie a categoria', 'error'); return false; }
      const obj = {
        id: l?.id || uid(),
        escopo: _escopo,
        descricao: desc,
        tipo: document.getElementById('m-tipo').value,
        valor,
        data: document.getElementById('m-data').value || todayStr(),
        categoria: cat,
        contaId: document.getElementById('m-conta').value || null,
        status: document.getElementById('m-status').value,
        recorrente: document.getElementById('m-rec').checked,
        freq: 'mensal',
      };
      if (l) Object.assign(l, obj); else _data.lancamentos.push(obj);
      saveData(); render(); return true;
    });
    // troca de Tipo recarrega as categorias do tipo; opção "nova categoria" abre prompt
    const selTipo = document.getElementById('m-tipo');
    const selCat = document.getElementById('m-cat');
    selTipo.addEventListener('change', () => { selCat.innerHTML = optsCategoria(selTipo.value, null); });
    selCat.addEventListener('change', async () => {
      if (selCat.value !== '__nova__') return;
      const novo = await criarCategoriaInline(selTipo.value);
      selCat.innerHTML = optsCategoria(selTipo.value, novo || null);
    });
  }

  // cria uma categoria nova na hora (usada pelo "＋ Nova categoria" do select)
  async function criarCategoriaInline(tipo) {
    const nome = await (window.nexusPrompt ? window.nexusPrompt('Nome da nova categoria:') : Promise.resolve(prompt('Nome da nova categoria:')));
    if (!nome || !nome.trim()) return null;
    const n = nome.trim();
    if (catObj(n)) { toast('Já existe essa categoria', 'error'); return n; }
    const novo = { nome: n, tipo };
    if (tipo === 'saida') {
      const g = await (window.nexusPrompt ? window.nexusPrompt('Grupo: fixa / variavel / investimento / diversos', 'variavel') : Promise.resolve(prompt('Grupo (fixa/variavel/investimento/diversos):', 'variavel')));
      const grupo = ['fixa', 'variavel', 'investimento', 'diversos'].includes((g || '').trim()) ? g.trim() : 'diversos';
      novo.grupo = grupo;
      novo.essencial = (grupo === 'fixa' || grupo === 'investimento');
    }
    _data.categorias.push(novo);
    saveData();
    return n;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: CONTAS
  // ════════════════════════════════════════════════════════════════════════
  function viewContas(el) {
    const sc = saldoContas();
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Contas — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
        <button id="fin-add-conta" style="margin-left:auto;${primBtn()}">+ Nova conta</button>
      </div>
      ${sc.contas.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">
        ${sc.contas.map(c => `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:var(--shadow-sm)">
          <div style="display:flex;justify-content:space-between;align-items:start">
            <div><div style="font-size:13px;font-weight:700;color:var(--text)">${esc(c.nome)}</div><div style="font-size:11px;color:var(--text3)">${esc(c.tipo || 'conta')}</div></div>
            <button class="fin-del-conta" data-id="${c.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer">✕</button>
          </div>
          <div style="font-size:20px;font-weight:800;font-family:'DM Mono',monospace;margin-top:10px;color:${sc.map[c.id] >= 0 ? 'var(--text)' : 'var(--red)'}">${money(sc.map[c.id])}</div>
        </div>`).join('')}
      </div>
      <div style="margin-top:14px;padding:14px 18px;background:var(--surface2);border-radius:10px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.4px">Saldo total</span>
        <span style="font-size:20px;font-weight:800;font-family:'DM Mono',monospace;color:var(--text)">${money(sc.total)}</span>
      </div>` : emptyBox('Nenhuma conta. Cadastre seu banco, carteira, cartão...')}
    `;
    document.getElementById('fin-add-conta').addEventListener('click', () => {
      modal('Nova conta', `
        <div style="display:grid;gap:12px">
          <div>${fLabel('Nome')}<input id="c-nome" placeholder="Ex: Nubank, Carteira, Inter PJ" style="${inp()}"/></div>
          <div>${fLabel('Tipo')}<select id="c-tipo" style="${inp()}"><option>Conta corrente</option><option>Poupança</option><option>Carteira</option><option>Cartão de crédito</option><option>Investimento</option></select></div>
          <div>${fLabel('Saldo inicial (R$)')}<input id="c-saldo" placeholder="0,00" style="${inp()}"/></div>
        </div>`, () => {
        const nome = document.getElementById('c-nome').value.trim();
        if (!nome) { toast('Informe o nome', 'error'); return false; }
        _data.contas.push({ id: uid(), escopo: _escopo, nome, tipo: document.getElementById('c-tipo').value, saldoInicial: parseFloat(String(document.getElementById('c-saldo').value).replace(/\./g, '').replace(',', '.')) || 0 });
        saveData(); render(); return true;
      });
    });
    el.querySelectorAll('.fin-del-conta').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir esta conta? Os lançamentos ligados a ela ficam sem conta.'))) return;
      _data.contas = _data.contas.filter(c => c.id !== b.dataset.id);
      _data.lancamentos.forEach(l => { if (l.contaId === b.dataset.id) l.contaId = null; });
      saveData(); render();
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: DÍVIDAS
  // ════════════════════════════════════════════════════════════════════════
  function viewDividas(el) {
    const dividas = (_data.dividas || []).filter(d => d.escopo === _escopo);
    const totalDevedor = dividas.reduce((a, d) => a + (Number(d.saldoDevedor) || 0), 0);
    const totalParcela = dividas.reduce((a, d) => a + (Number(d.parcela) || 0), 0);
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Dívidas — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
        <button id="fin-add-div" style="margin-left:auto;${primBtn()}">+ Nova dívida</button>
      </div>
      ${dividas.length ? `<div style="display:grid;gap:12px">
        ${dividas.map(d => {
          const prog = d.parcelasTotais ? (d.parcelasPagas || 0) / d.parcelasTotais : 0;
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow-sm)">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <div><div style="font-size:14px;font-weight:700;color:var(--text)">${esc(d.credor)}</div>
                <div style="font-size:11px;color:var(--text3)">${d.parcela ? money(d.parcela) + '/mês' : ''} ${d.jurosMes ? '· ' + d.jurosMes + '% a.m.' : ''} ${d.diaVcto ? '· vence dia ' + d.diaVcto : ''}</div></div>
              <div style="text-align:right"><div style="font-size:18px;font-weight:800;font-family:'DM Mono',monospace;color:#dc2626">${money(d.saldoDevedor)}</div><div style="font-size:10px;color:var(--text3)">saldo devedor</div></div>
            </div>
            ${d.parcelasTotais ? `<div style="height:7px;background:var(--surface2);border-radius:4px;overflow:hidden;margin:6px 0"><div style="height:100%;width:${(prog * 100).toFixed(0)}%;background:#16a34a"></div></div>
            <div style="font-size:11px;color:var(--text3)">${d.parcelasPagas || 0} de ${d.parcelasTotais} parcelas pagas (${pct(prog)})</div>` : ''}
            <div style="margin-top:10px;text-align:right">
              <button class="fin-pay-parc" data-id="${d.id}" style="background:none;border:1px solid #86efac;color:#16a34a;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;margin-right:4px">Pagar 1 parcela</button>
              <button class="fin-del-div" data-id="${d.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Excluir</button>
            </div>
          </div>`;
        }).join('')}
        <div style="padding:14px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;display:flex;justify-content:space-between">
          <span style="font-size:12px;font-weight:700;color:#991b1b">Total devedor · parcelas/mês</span>
          <span style="font-size:14px;font-weight:800;font-family:'DM Mono',monospace;color:#991b1b">${money(totalDevedor)} · ${money(totalParcela)}/mês</span>
        </div>
      </div>` : emptyBox('Sem dívidas cadastradas. 🎉')}
    `;
    document.getElementById('fin-add-div').addEventListener('click', () => {
      modal('Nova dívida', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">${fLabel('Credor / descrição')}<input id="d-credor" placeholder="Ex: Financiamento carro, Empréstimo banco" style="${inp()}"/></div>
          <div>${fLabel('Saldo devedor (R$)')}<input id="d-saldo" placeholder="0,00" style="${inp()}"/></div>
          <div>${fLabel('Parcela mensal (R$)')}<input id="d-parc" placeholder="0,00" style="${inp()}"/></div>
          <div>${fLabel('Parcelas totais')}<input id="d-ptot" type="number" placeholder="ex: 48" style="${inp()}"/></div>
          <div>${fLabel('Parcelas pagas')}<input id="d-ppag" type="number" placeholder="0" style="${inp()}"/></div>
          <div>${fLabel('Juros (% a.m.)')}<input id="d-juros" placeholder="ex: 1.5" style="${inp()}"/></div>
          <div>${fLabel('Dia do vencimento')}<input id="d-dia" type="number" placeholder="ex: 10" style="${inp()}"/></div>
        </div>`, () => {
        const credor = document.getElementById('d-credor').value.trim();
        if (!credor) { toast('Informe o credor', 'error'); return false; }
        const num = (id) => parseFloat(String(document.getElementById(id).value).replace(/\./g, '').replace(',', '.')) || 0;
        _data.dividas.push({
          id: uid(), escopo: _escopo, credor,
          saldoDevedor: num('d-saldo'), parcela: num('d-parc'),
          parcelasTotais: parseInt(document.getElementById('d-ptot').value) || 0,
          parcelasPagas: parseInt(document.getElementById('d-ppag').value) || 0,
          jurosMes: num('d-juros'), diaVcto: parseInt(document.getElementById('d-dia').value) || null,
        });
        saveData(); render(); return true;
      });
    });
    el.querySelectorAll('.fin-pay-parc').forEach(b => b.addEventListener('click', () => {
      const d = _data.dividas.find(x => x.id === b.dataset.id);
      if (!d) return;
      d.parcelasPagas = (d.parcelasPagas || 0) + 1;
      d.saldoDevedor = Math.max(0, (Number(d.saldoDevedor) || 0) - (Number(d.parcela) || 0));
      saveData(); render();
    }));
    el.querySelectorAll('.fin-del-div').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir esta dívida?'))) return;
      _data.dividas = _data.dividas.filter(x => x.id !== b.dataset.id);
      saveData(); render();
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: COTAS / INVESTIMENTOS
  // ════════════════════════════════════════════════════════════════════════
  function viewCotas(el) {
    const cotas = (_data.cotas || []).filter(c => c.escopo === _escopo);
    const totAporte = cotas.reduce((a, c) => a + (Number(c.aporte) || 0), 0);
    const totAtual = cotas.reduce((a, c) => a + (Number(c.valorAtual) || 0), 0);
    const rend = totAtual - totAporte;
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Cotas / Investimentos — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
        <button id="fin-add-cota" style="margin-left:auto;${primBtn()}">+ Nova cota</button>
      </div>
      ${cotas.length ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:14px">
        ${kpi('Total aplicado', money(totAporte))}
        ${kpi('Valor atual', money(totAtual))}
        ${kpi('Rendimento', (rend >= 0 ? '+' : '') + money(rend), totAporte > 0 ? pct(rend / totAporte) + ' no total' : '', rend >= 0 ? '#16a34a' : '#dc2626')}
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="background:var(--surface2)"><tr>${['Nome', 'Instituição', 'Aplicado', 'Atual', 'Rend.', ''].map(h => `<th style="padding:9px 12px;text-align:${['Aplicado', 'Atual', 'Rend.'].includes(h) ? 'right' : 'left'};font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase">${h}</th>`).join('')}</tr></thead>
          <tbody>${cotas.map(c => {
            const r = (Number(c.valorAtual) || 0) - (Number(c.aporte) || 0);
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:9px 12px;color:var(--text);font-weight:500">${esc(c.nome)}</td>
              <td style="padding:9px 12px;color:var(--text2)">${esc(c.instituicao || '—')}</td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;color:var(--text2)">${money(c.aporte)}</td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;color:var(--text)">${money(c.valorAtual)}</td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${r >= 0 ? '#16a34a' : '#dc2626'}">${(r >= 0 ? '+' : '') + money(r)}</td>
              <td style="padding:9px 12px;text-align:right"><button class="fin-del-cota" data-id="${c.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:3px 7px;font-size:10px;cursor:pointer">✕</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : emptyBox('Nenhuma cota/investimento cadastrado.')}
    `;
    document.getElementById('fin-add-cota').addEventListener('click', () => {
      modal('Nova cota / investimento', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">${fLabel('Nome')}<input id="k-nome" placeholder="Ex: Tesouro Selic, Cota A2Z, CDB Inter" style="${inp()}"/></div>
          <div>${fLabel('Instituição')}<input id="k-inst" placeholder="Ex: Inter, XP" style="${inp()}"/></div>
          <div>${fLabel('Data do aporte')}<input id="k-data" type="date" value="${todayStr()}" style="${inp()}"/></div>
          <div>${fLabel('Valor aplicado (R$)')}<input id="k-aporte" placeholder="0,00" style="${inp()}"/></div>
          <div>${fLabel('Valor atual (R$)')}<input id="k-atual" placeholder="0,00" style="${inp()}"/></div>
        </div>`, () => {
        const nome = document.getElementById('k-nome').value.trim();
        if (!nome) { toast('Informe o nome', 'error'); return false; }
        const num = (id) => parseFloat(String(document.getElementById(id).value).replace(/\./g, '').replace(',', '.')) || 0;
        const ap = num('k-aporte');
        _data.cotas.push({ id: uid(), escopo: _escopo, nome, instituicao: document.getElementById('k-inst').value.trim(), dataAporte: document.getElementById('k-data').value, aporte: ap, valorAtual: num('k-atual') || ap });
        saveData(); render(); return true;
      });
    });
    el.querySelectorAll('.fin-del-cota').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir esta cota?'))) return;
      _data.cotas = _data.cotas.filter(x => x.id !== b.dataset.id);
      saveData(); render();
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: PREVISÃO
  // ════════════════════════════════════════════════════════════════════════
  function viewPrevisao(el) {
    const sc = saldoContas();
    const rendaFixa = rendaFixaTotal();
    const rendaRef = rendaReferencia();

    // base recorrente / médias
    const recs = lancEscopo().filter(l => l.recorrente);
    const recSaida = recs.filter(l => l.tipo === 'saida').reduce((a, l) => a + (Number(l.valor) || 0), 0);
    const parcelasDivida = (_data.dividas || []).filter(d => d.escopo === _escopo).reduce((a, d) => a + (Number(d.parcela) || 0), 0);
    const meses3 = lastNMonths(3);
    const medSaida = meses3.reduce((a, k) => a + totaisMes(k).saidas, 0) / 3;

    const estEntrada = rendaRef;
    const estSaidaBase = Math.max(recSaida + parcelasDivida, medSaida);
    const fluxoMes = estEntrada - estSaidaBase;

    // ── PLANO DE ALOCAÇÃO (quanto reservar por grupo) ──
    const aloc = (_data.alocacao && _data.alocacao[_escopo]) || { fixa: 50, variavel: 15, investimento: 20, diversos: 15 };
    // gasto real médio por grupo (3 meses) para comparar com o alvo
    const gastoGrupo = { fixa: 0, variavel: 0, investimento: 0, diversos: 0 };
    meses3.forEach(k => {
      lancEscopo().forEach(l => {
        if (l.tipo !== 'saida' || l.status === 'pendente' || monthKey(l.data) !== k) return;
        const g = grupoDaCat(l.categoria); gastoGrupo[g] = (gastoGrupo[g] || 0) + (Number(l.valor) || 0);
      });
    });
    Object.keys(gastoGrupo).forEach(g => gastoGrupo[g] /= 3);

    const planoCards = Object.keys(GRUPOS).map(g => {
      const alvoR = rendaRef * (Number(aloc[g]) || 0) / 100;
      const realR = gastoGrupo[g] || 0;
      const diff = alvoR - realR;
      const acima = realR > alvoR * 1.05;
      return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;box-shadow:var(--shadow-sm)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="width:10px;height:10px;border-radius:3px;background:${GRUPOS[g].cor}"></span><span style="font-size:12px;font-weight:700;color:var(--text)">${GRUPOS[g].lbl}</span><span style="margin-left:auto;font-size:10px;color:var(--text3)">${aloc[g] || 0}% da renda</span></div>
        <div style="font-size:20px;font-weight:800;font-family:'DM Mono',monospace;color:var(--text)">${money(alvoR)}<span style="font-size:11px;color:var(--text3);font-weight:400">/mês reservar</span></div>
        <div style="font-size:11px;margin-top:5px;color:${acima ? '#dc2626' : 'var(--text3)'}">Você gasta ~${money(realR)}/mês · ${diff >= 0 ? 'folga de ' + money(diff) : 'estouro de ' + money(-diff)}</div>
      </div>`;
    }).join('');

    // projeção de saldo 6 meses
    let saldo = sc.total; const proj = []; const base = new Date(); base.setDate(1);
    for (let i = 1; i <= 6; i++) { saldo += fluxoMes; proj.push({ mk: monthKey(addMonths(base, i)), saldo, fluxo: fluxoMes }); }
    const minV = Math.min(sc.total, ...proj.map(p => p.saldo));
    const maxV = Math.max(sc.total, ...proj.map(p => p.saldo), 1);
    const range = (maxV - minV) || 1;
    const h = (v) => 20 + Math.round(((v - minV) / range) * 110);

    el.innerHTML = `
      ${rendaFixa === 0 ? banner('#fffbeb', '#fde68a', '#92400e', 'Cadastre sua renda fixa', 'Vá em <strong>Configurar → Renda fixa</strong> e cadastre seu salário. A previsão e o plano de alocação ficam muito mais precisos.') : ''}

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px">
        ${kpi('Renda de referência', money(rendaRef), rendaFixa > 0 ? 'renda fixa cadastrada' : 'média dos últimos meses')}
        ${kpi('Saída estimada/mês', money(estSaidaBase), 'inclui ' + money(parcelasDivida) + ' de dívidas')}
        ${kpi('Fluxo mensal', (fluxoMes >= 0 ? '+' : '') + money(fluxoMes), fluxoMes >= 0 ? 'sobra' : 'déficit', fluxoMes >= 0 ? '#16a34a' : '#dc2626')}
        ${kpi('Saldo hoje', money(sc.total))}
      </div>

      <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Plano de alocação — quanto reservar por mês</div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Com base na sua renda de ${money(rendaRef)} e na divisão definida em Configurar. Ajuste os % lá.</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">${planoCards}</div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm);margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:16px">Projeção de saldo — próximos 6 meses</div>
        <div style="display:flex;align-items:flex-end;gap:12px;height:160px;border-bottom:1px solid var(--border)">
          ${proj.map(p => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
            <div style="font-size:9px;font-family:'DM Mono',monospace;color:${p.saldo >= 0 ? 'var(--text2)' : 'var(--red)'};margin-bottom:3px">${(p.saldo / 1000).toFixed(1)}k</div>
            <div title="${money(p.saldo)}" style="width:70%;height:${h(p.saldo)}px;background:${p.saldo >= 0 ? 'linear-gradient(180deg,var(--accent),#60a5fa)' : 'linear-gradient(180deg,#ef4444,#f87171)'};border-radius:4px 4px 0 0"></div>
          </div>`).join('')}
        </div>
        <div style="display:flex;gap:12px;margin-top:6px">${proj.map(p => `<div style="flex:1;text-align:center;font-size:9px;color:var(--text3);font-family:'DM Mono',monospace">${p.mk.slice(5)}/${p.mk.slice(2, 4)}</div>`).join('')}</div>
      </div>

      ${alertaPrevisao(proj, fluxoMes)}
    `;
  }

  function alertaPrevisao(proj, fluxoMes) {
    const neg = proj.find(p => p.saldo < 0);
    if (fluxoMes < 0 && neg) {
      return banner('#fef2f2', '#fecaca', '#991b1b', '⚠ Alerta de caixa',
        `No ritmo atual você gasta mais do que ganha (déficit de ${money(-fluxoMes)}/mês). Seu saldo fica negativo em <strong>${nomeMes(neg.mk)}</strong>. Veja a aba <strong>Análise</strong> para onde cortar.`);
    }
    if (fluxoMes < 0) {
      return banner('#fffbeb', '#fde68a', '#92400e', 'Atenção',
        `Você está com déficit de ${money(-fluxoMes)}/mês, mas o saldo atual segura por enquanto. Reduza gastos para não comprometer o caixa.`);
    }
    return banner('#f0fdf4', '#bbf7d0', '#166534', '✓ No azul',
      `Você sobra ${money(fluxoMes)}/mês. Em 6 meses o saldo projetado chega a <strong>${money(proj[proj.length - 1].saldo)}</strong>. Considere investir o excedente (aba Cotas).`);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: ANÁLISE INTELIGENTE
  // ════════════════════════════════════════════════════════════════════════
  function viewAnalise(el) {
    const mk = curMonth();
    const m = totaisMes(mk);
    const insights = [];

    // 1) taxa de poupança
    const taxa = m.entradas > 0 ? m.saldo / m.entradas : 0;
    if (m.entradas > 0) {
      if (taxa < 0) insights.push(['#fef2f2', '#fecaca', '#991b1b', 'Você está gastando mais do que ganha', `Neste mês as saídas (${money(m.saidas)}) superaram as entradas (${money(m.entradas)}). Corte os gastos supérfluos listados abaixo com urgência.`]);
      else if (taxa < 0.1) insights.push(['#fffbeb', '#fde68a', '#92400e', 'Poupança baixa', `Você está guardando só ${pct(taxa)} do que ganha. O ideal é ≥ 20%. Veja onde cortar abaixo.`]);
      else if (taxa >= 0.2) insights.push(['#f0fdf4', '#bbf7d0', '#166534', 'Boa taxa de poupança', `Você guardou ${pct(taxa)} da renda neste mês. Continue assim — considere investir.`]);
    }

    // 2) categoria que mais cresceu vs média 3 meses anteriores
    const catsAtual = gastosPorCategoria(mk);
    const meses3 = lastNMonths(4).slice(0, 3); // 3 meses ANTES do atual
    const medCat = {};
    meses3.forEach(k => { const g = gastosPorCategoria(k); Object.entries(g).forEach(([c, v]) => { medCat[c] = (medCat[c] || 0) + v / 3; }); });
    let maiorAlta = null;
    Object.entries(catsAtual).forEach(([c, v]) => {
      const base = medCat[c] || 0;
      if (base > 0 && v > base * 1.3) { const alta = v - base; if (!maiorAlta || alta > maiorAlta.alta) maiorAlta = { cat: c, v, base, alta, p: (v / base - 1) }; }
    });
    if (maiorAlta) insights.push(['#fffbeb', '#fde68a', '#92400e', `“${esc(maiorAlta.cat)}” disparou`, `Você gastou ${money(maiorAlta.v)} em ${esc(maiorAlta.cat)} este mês — ${pct(maiorAlta.p)} acima da sua média (${money(maiorAlta.base)}). Vale investigar.`]);

    // 3) comprometimento com dívida
    const parcelas = (_data.dividas || []).filter(d => d.escopo === _escopo).reduce((a, d) => a + (Number(d.parcela) || 0), 0);
    const rendaRef = m.entradas || rendaReferencia();
    if (parcelas > 0 && rendaRef > 0) {
      const comp = parcelas / rendaRef;
      if (comp > 0.3) insights.push(['#fef2f2', '#fecaca', '#991b1b', 'Dívidas pesando', `${pct(comp)} da sua renda vai para parcelas de dívida (${money(parcelas)}/mês). Acima de 30% é zona de risco — priorize quitar a dívida de maior juros.`]);
      else insights.push(['#eff6ff', '#bfdbfe', '#1e40af', 'Dívidas sob controle', `${pct(comp)} da renda em parcelas. Dentro do saudável (< 30%).`]);
    }

    // ranking supérfluos (onde cortar)
    const superfluos = Object.entries(catsAtual).filter(([c]) => !isEssencial(c)).sort((a, b) => b[1] - a[1]);
    const totalSuperf = superfluos.reduce((a, [, v]) => a + v, 0);

    // top consumidores geral
    const topGeral = Object.entries(catsAtual).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const totGasto = Object.values(catsAtual).reduce((a, b) => a + b, 0) || 1;

    // Score de saúde financeira no topo da análise
    const s = computeSaude();
    const scoreCard = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm);margin-bottom:16px;display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <div style="text-align:center;min-width:120px">
          <div style="font-size:44px;font-weight:800;font-family:'DM Mono',monospace;color:${s.nivel.cor};line-height:1">${s.score}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">de 100</div>
          <div style="font-size:12px;font-weight:700;color:${s.nivel.cor};margin-top:4px">${s.nivel.lbl}</div>
        </div>
        <div style="flex:1;min-width:240px">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:10px">Saúde financeira · ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
          ${s.partes.map(p => `<div style="margin-bottom:7px">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px"><span style="color:var(--text2)">${p.nome} <span style="color:var(--text3)">· ${p.txt}</span></span><span style="font-family:'DM Mono',monospace;color:var(--text)">${p.pts}/${p.max}</span></div>
            <div style="height:5px;background:var(--surface2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${(p.pts / p.max * 100).toFixed(0)}%;background:${p.pts / p.max >= 0.7 ? '#16a34a' : p.pts / p.max >= 0.4 ? '#d97706' : '#dc2626'}"></div></div>
          </div>`).join('')}
        </div>
      </div>`;

    el.innerHTML = `
      ${scoreCard}
      ${insights.length ? insights.map(i => banner(i[0], i[1], i[2], i[3], i[4])).join('') : banner('#f8fafc', 'var(--border)', 'var(--text3)', 'Sem dados suficientes', 'Lance suas entradas e saídas do mês para a análise gerar recomendações.')}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm)">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:14px">O que mais consome · ${nomeMes(mk)}</div>
          ${topGeral.length ? topGeral.map(([c, v]) => `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:var(--text2)">${esc(c)}</span><span style="font-family:'DM Mono',monospace;color:var(--text)">${money(v)} · ${pct(v / totGasto)}</span></div>
            <div style="height:7px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${(v / totGasto * 100).toFixed(0)}%;background:${isEssencial(c) ? 'var(--accent)' : '#f59e0b'}"></div></div>
          </div>`).join('') : '<div style="color:var(--text3);font-size:12px">Sem gastos.</div>'}
        </div>

        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm)">
          <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:6px">Onde cortar</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:14px">Gastos não essenciais — cortar aqui é o caminho mais rápido para sobrar dinheiro.</div>
          ${superfluos.length ? `
            <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Você gastou <strong style="color:#d97706">${money(totalSuperf)}</strong> em supérfluos este mês (${pct(totalSuperf / totGasto)} do total).</div>
            ${superfluos.slice(0, 6).map(([c, v]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border)">
              <span style="font-size:12px;color:var(--text2)">${esc(c)}</span>
              <span style="font-size:12px;font-family:'DM Mono',monospace;color:#d97706;font-weight:700">${money(v)}</span>
            </div>`).join('')}
            <div style="margin-top:12px;padding:10px 12px;background:#f0fdf4;border-radius:8px;font-size:12px;color:#166534">💡 Cortando metade dos supérfluos, você economizaria <strong>${money(totalSuperf / 2)}/mês</strong> = ${money(totalSuperf * 6)}/ano.</div>
          ` : '<div style="color:var(--text3);font-size:12px">Nenhum gasto supérfluo classificado neste mês. 👏</div>'}
        </div>
      </div>
    `;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  UI helpers (modal, inputs, banners)
  // ════════════════════════════════════════════════════════════════════════
  function fLabel(t) { return `<label style="display:block;font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px;margin-bottom:5px">${t}</label>`; }
  function inp() { return 'width:100%;padding:9px 11px;font-family:inherit;font-size:13px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);outline:none;box-sizing:border-box'; }
  function emptyBox(msg) { return `<div style="padding:48px 20px;text-align:center;color:var(--text3);font-size:13px;background:var(--surface);border:1px dashed var(--border);border-radius:12px">${msg}</div>`; }
  function banner(bg, bd, fg, titulo, txt) {
    return `<div style="background:${bg};border:1px solid ${bd};border-radius:10px;padding:14px 16px;margin-bottom:10px">
      <div style="font-size:13px;font-weight:800;color:${fg};margin-bottom:3px">${titulo}</div>
      <div style="font-size:12px;color:${fg};line-height:1.55;opacity:.92">${txt || ''}</div>
    </div>`;
  }

  function modal(titulo, bodyHtml, onSave) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:99999;padding:20px';
    ov.innerHTML = `
      <div style="background:var(--surface);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.3);width:100%;max-width:520px;max-height:90vh;overflow:auto">
        <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center">
          <div style="font-size:16px;font-weight:700;color:var(--text)">${titulo}</div>
          <button id="m-x" style="margin-left:auto;background:none;border:none;font-size:22px;color:var(--text3);cursor:pointer;line-height:1">×</button>
        </div>
        <div style="padding:22px">${bodyHtml}</div>
        <div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:10px;justify-content:flex-end">
          <button id="m-cancel" style="${ghostBtn()}">Cancelar</button>
          <button id="m-save" style="${primBtn()}">Salvar</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#m-x').addEventListener('click', close);
    ov.querySelector('#m-cancel').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#m-save').addEventListener('click', () => { const ok = onSave(); if (ok !== false) close(); });
    setTimeout(() => { const f = ov.querySelector('input,select'); if (f) f.focus(); }, 60);
  }

  async function confirmar(msg) {
    if (window.nexusConfirm) { try { return await window.nexusConfirm(msg); } catch {} }
    return window.confirm(msg);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: CONFIGURAR (renda fixa pré-setada + categorias + alocação)
  // ════════════════════════════════════════════════════════════════════════
  function viewConfig(el) {
    const rendas = (_data.rendasFixas || []).filter(r => r.escopo === _escopo);
    const totRenda = rendas.reduce((a, r) => a + (Number(r.valor) || 0), 0);
    const aloc = (_data.alocacao && _data.alocacao[_escopo]) || { fixa: 50, variavel: 15, investimento: 20, diversos: 15 };
    const somaAloc = Object.values(aloc).reduce((a, b) => a + (Number(b) || 0), 0);
    const cats = _data.categorias || [];

    el.innerHTML = `
      <!-- RENDA FIXA -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm);margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <div style="font-size:14px;font-weight:700;color:var(--text)">Renda fixa mensal — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
          <button id="cfg-add-renda" style="margin-left:auto;${primBtn()}">+ Renda fixa</button>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Cadastre aqui seu salário e outros ganhos fixos. É a base das previsões e da alocação automática.</div>
        ${rendas.length ? `<div style="display:flex;flex-direction:column;gap:8px">
          ${rendas.map(r => `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2);border-radius:8px">
            <div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">${esc(r.nome)}</div><div style="font-size:11px;color:var(--text3)">${esc(r.categoria || 'Salário')}${r.dia ? ' · todo dia ' + r.dia : ''}</div></div>
            <div style="font-size:15px;font-weight:800;font-family:'DM Mono',monospace;color:#16a34a">${money(r.valor)}</div>
            <button class="cfg-del-renda" data-id="${r.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer">✕</button>
          </div>`).join('')}
          <div style="display:flex;justify-content:space-between;padding:10px 14px;border-top:2px solid var(--border);margin-top:4px">
            <span style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase">Total renda fixa</span>
            <span style="font-size:16px;font-weight:800;font-family:'DM Mono',monospace;color:#16a34a">${money(totRenda)}/mês</span>
          </div>
        </div>` : emptyBox('Nenhuma renda fixa. Cadastre seu salário para começar as previsões.')}
      </div>

      <!-- ALOCAÇÃO -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm);margin-bottom:16px">
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">Como dividir a renda (alocação alvo)</div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:14px">Defina quanto % da renda vai para cada grupo. A previsão usa isso para dizer quanto reservar. ${somaAloc !== 100 ? `<span style="color:#d97706;font-weight:600">Soma atual: ${somaAloc}% (ideal 100%)</span>` : '<span style="color:#16a34a">Soma: 100% ✓</span>'}</div>
        ${Object.keys(GRUPOS).map(g => {
          const v = Number(aloc[g]) || 0;
          const valorR = totRenda * v / 100;
          return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
            <div style="width:130px;font-size:12px;color:var(--text2)"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${GRUPOS[g].cor};margin-right:5px"></span>${GRUPOS[g].lbl}</div>
            <input type="number" min="0" max="100" value="${v}" data-grupo="${g}" class="cfg-aloc" style="width:70px;padding:6px 8px;font-family:'DM Mono',monospace;font-size:12px;text-align:right;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)"/>
            <span style="font-size:12px;color:var(--text3)">%</span>
            <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.min(100, v)}%;background:${GRUPOS[g].cor}"></div></div>
            <div style="width:110px;text-align:right;font-family:'DM Mono',monospace;font-size:12px;color:var(--text2)">${money(valorR)}</div>
          </div>`;
        }).join('')}
        <div style="font-size:11px;color:var(--text3);margin-top:8px">Sugestão clássica (50/30/20): 50% fixas, 30% variáveis+diversos, 20% investir. Ajuste ao seu momento.</div>
      </div>

      <!-- CATEGORIAS -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm)">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <div style="font-size:14px;font-weight:700;color:var(--text)">Categorias</div>
          <button id="cfg-add-cat" style="margin-left:auto;${primBtn()}">+ Categoria</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
          <div>
            <div style="font-size:11px;font-weight:700;color:#16a34a;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Entradas</div>
            ${catsDoTipo('entrada').map(c => catChip(c)).join('') || '<div style="font-size:12px;color:var(--text3)">—</div>'}
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Saídas</div>
            ${catsDoTipo('saida').map(c => catChip(c)).join('') || '<div style="font-size:12px;color:var(--text3)">—</div>'}
          </div>
        </div>
      </div>
    `;

    // renda fixa
    document.getElementById('cfg-add-renda').addEventListener('click', () => {
      const cats = catsDoTipo('entrada');
      modal('Nova renda fixa', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">${fLabel('Nome')}<input id="rf-nome" placeholder="Ex: Salário A2Z, Pró-labore" style="${inp()}"/></div>
          <div>${fLabel('Valor mensal (R$)')}<input id="rf-valor" placeholder="0,00" style="${inp()}"/></div>
          <div>${fLabel('Dia do recebimento')}<input id="rf-dia" type="number" min="1" max="31" placeholder="ex: 5" style="${inp()}"/></div>
          <div style="grid-column:1/-1">${fLabel('Categoria')}<select id="rf-cat" style="${inp()}">${cats.map(c => `<option ${c.nome === 'Salário' ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
        </div>`, () => {
        const nome = document.getElementById('rf-nome').value.trim();
        const valor = parseFloat(String(document.getElementById('rf-valor').value).replace(/\./g, '').replace(',', '.')) || 0;
        if (!nome) { toast('Informe o nome', 'error'); return false; }
        if (valor <= 0) { toast('Valor inválido', 'error'); return false; }
        _data.rendasFixas.push({ id: uid(), escopo: _escopo, nome, valor, categoria: document.getElementById('rf-cat').value, dia: parseInt(document.getElementById('rf-dia').value) || null });
        saveData(); renderView(); return true;
      });
    });
    el.querySelectorAll('.cfg-del-renda').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Remover esta renda fixa?'))) return;
      _data.rendasFixas = _data.rendasFixas.filter(x => x.id !== b.dataset.id);
      saveData(); renderView();
    }));

    // alocação
    el.querySelectorAll('.cfg-aloc').forEach(inp2 => inp2.addEventListener('change', () => {
      if (!_data.alocacao[_escopo]) _data.alocacao[_escopo] = {};
      _data.alocacao[_escopo][inp2.dataset.grupo] = Math.max(0, Math.min(100, parseInt(inp2.value) || 0));
      saveData(); renderView();
    }));

    // categorias
    document.getElementById('cfg-add-cat').addEventListener('click', async () => {
      const tipo = await (window.nexusPrompt ? window.nexusPrompt('Tipo: entrada ou saida', 'saida') : Promise.resolve(prompt('Tipo (entrada/saida):', 'saida')));
      const t = (tipo || '').trim() === 'entrada' ? 'entrada' : 'saida';
      const nome = await criarCategoriaInline(t);
      if (nome) renderView();
    });
    el.querySelectorAll('.cfg-del-cat').forEach(b => b.addEventListener('click', async () => {
      const nome = b.dataset.nome;
      const usos = (_data.lancamentos || []).filter(l => l.categoria === nome).length;
      if (!(await confirmar(`Excluir a categoria "${nome}"?` + (usos ? ` ${usos} lançamento(s) usam ela e ficarão como "Outros".` : '')))) return;
      _data.categorias = _data.categorias.filter(c => c.nome !== nome);
      if (usos) _data.lancamentos.forEach(l => { if (l.categoria === nome) l.categoria = 'Outros'; });
      saveData(); renderView();
    }));
  }

  function catChip(c) {
    const grupoTag = c.tipo === 'saida' ? `<span style="font-size:9px;color:${GRUPOS[c.grupo || 'diversos'].cor}">${GRUPOS[c.grupo || 'diversos'].lbl}</span>` : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface2);border-radius:7px;margin-bottom:5px">
      <div style="flex:1"><span style="font-size:12px;color:var(--text)">${esc(c.nome)}</span> ${grupoTag}</div>
      <button class="cfg-del-cat" data-nome="${esc(c.nome)}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:13px" title="Excluir">✕</button>
    </div>`;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: ORÇAMENTO (planejado × realizado por categoria)
  // ════════════════════════════════════════════════════════════════════════
  function viewOrcamento(el) {
    const mk = curMonth();
    const budget = (_data.orcamento && _data.orcamento[_escopo]) || {};
    const gasto = gastosPorCategoria(mk);
    // une categorias do orçamento + categorias com gasto no mês
    const nomes = Array.from(new Set([...Object.keys(budget), ...Object.keys(gasto), ...(_data.categorias || []).map(c => c.nome)]));
    const planTotal = Object.values(budget).reduce((a, b) => a + (Number(b) || 0), 0);
    const gastoTotal = Object.values(gasto).reduce((a, b) => a + b, 0);

    const rows = nomes.filter(n => (budget[n] || gasto[n])).sort((a, b) => (gasto[b] || 0) - (gasto[a] || 0));

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Orçamento mensal — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'} · ${nomeMes(mk)}</div>
      </div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:16px">Defina um limite por categoria. A aba mostra quanto você já gastou e avisa quando passar do planejado.</div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:18px">
        ${kpi('Planejado (mês)', money(planTotal))}
        ${kpi('Gasto até agora', money(gastoTotal), pct(planTotal > 0 ? gastoTotal / planTotal : 0) + ' do planejado')}
        ${kpi('Disponível', money(planTotal - gastoTotal), planTotal - gastoTotal >= 0 ? 'dentro do orçamento' : 'estourou', planTotal - gastoTotal >= 0 ? '#16a34a' : '#dc2626')}
      </div>

      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead style="background:var(--surface2)"><tr>
            ${['Categoria', 'Limite/mês', 'Gasto', 'Uso', 'Sobra'].map((h, i) => `<th style="padding:9px 12px;text-align:${i === 0 ? 'left' : 'right'};font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.4px">${h}</th>`).join('')}
          </tr></thead><tbody>
          ${rows.length ? rows.map(cat => {
            const lim = Number(budget[cat]) || 0;
            const g = gasto[cat] || 0;
            const uso = lim > 0 ? g / lim : (g > 0 ? 1.5 : 0);
            const cor = !lim ? 'var(--text3)' : uso > 1 ? '#dc2626' : uso > 0.85 ? '#d97706' : '#16a34a';
            return `<tr style="border-top:1px solid var(--border)">
              <td style="padding:9px 12px;color:var(--text)">${esc(cat)} ${isEssencial(cat) ? '' : '<span style="font-size:9px;color:#d97706">• supérfluo</span>'}</td>
              <td style="padding:9px 12px;text-align:right"><input type="text" value="${lim ? lim : ''}" placeholder="—" data-cat="${esc(cat)}" class="fin-orc-lim" style="width:90px;padding:4px 6px;font-family:'DM Mono',monospace;font-size:11px;text-align:right;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"/></td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;color:var(--text2)">${money(g)}</td>
              <td style="padding:9px 12px;text-align:right;min-width:120px">
                ${lim ? `<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end"><div style="width:70px;height:7px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.min(100, uso * 100).toFixed(0)}%;background:${cor}"></div></div><span style="font-family:'DM Mono',monospace;font-size:11px;color:${cor};font-weight:700">${(uso * 100).toFixed(0)}%</span></div>` : '<span style="color:var(--text3);font-size:11px">sem limite</span>'}
              </td>
              <td style="padding:9px 12px;text-align:right;font-family:'DM Mono',monospace;font-weight:700;color:${cor}">${lim ? money(lim - g) : '—'}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--text3);font-size:12px">Nenhuma categoria com gasto ou limite. Lance despesas ou defina limites.</td></tr>`}
        </tbody></table>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text3)">Digite o limite e clique fora do campo para salvar. Deixe vazio para remover o limite.</div>
    `;
    el.querySelectorAll('.fin-orc-lim').forEach(inp => inp.addEventListener('change', () => {
      const cat = inp.dataset.cat;
      const v = parseFloat(String(inp.value).replace(/\./g, '').replace(',', '.'));
      if (!_data.orcamento[_escopo]) _data.orcamento[_escopo] = {};
      if (!v || v <= 0) delete _data.orcamento[_escopo][cat];
      else _data.orcamento[_escopo][cat] = v;
      saveData(); renderView();
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  VIEW: METAS (objetivos + reserva de emergência)
  // ════════════════════════════════════════════════════════════════════════
  function viewMetas(el) {
    const metas = (_data.metas || []).filter(m => m.escopo === _escopo);
    const pl = patrimonioLiquido();
    const saude = computeSaude();
    const alvoMeses = _data.config.reservaMeses || 6;
    const reservaAlvo = saude.gastoMes * alvoMeses;
    const reservaAtual = pl.saldo + pl.cotas;
    const reservaProg = reservaAlvo > 0 ? Math.min(1, reservaAtual / reservaAlvo) : 0;

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--text)">Metas — ${_escopo === 'pessoal' ? 'Pessoal' : 'A2Z'}</div>
        <button id="fin-add-meta" style="margin-left:auto;${primBtn()}">+ Nova meta</button>
      </div>

      <!-- Reserva de emergência (meta automática) -->
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px;box-shadow:var(--shadow-sm);margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div><div style="font-size:14px;font-weight:700;color:var(--text)">🛟 Reserva de emergência</div>
            <div style="font-size:11px;color:var(--text3)">Meta: ${alvoMeses} meses de gasto (${money(reservaAlvo)}) · cobre hoje ${saude.mesesCobre.toFixed(1)} meses</div></div>
          <div style="text-align:right"><div style="font-size:18px;font-weight:800;font-family:'DM Mono',monospace;color:var(--text)">${money(reservaAtual)}</div><div style="font-size:10px;color:var(--text3)">de ${money(reservaAlvo)}</div></div>
        </div>
        <div style="height:9px;background:var(--surface2);border-radius:5px;overflow:hidden"><div style="height:100%;width:${(reservaProg * 100).toFixed(0)}%;background:${reservaProg >= 1 ? '#16a34a' : reservaProg >= 0.5 ? '#65a30d' : '#d97706'}"></div></div>
        <div style="font-size:11px;color:var(--text3);margin-top:6px">${reservaProg >= 1 ? '✓ Reserva completa. Excelente.' : 'Faltam ' + money(Math.max(0, reservaAlvo - reservaAtual)) + ' para completar.'} <button id="fin-cfg-reserva" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:11px;text-decoration:underline;padding:0;margin-left:4px">alterar meses</button></div>
      </div>

      ${metas.length ? `<div style="display:grid;gap:12px">
        ${metas.map(m => {
          const prog = m.alvo > 0 ? Math.min(1, (Number(m.guardado) || 0) / m.alvo) : 0;
          let faltaMes = '';
          if (m.prazo) {
            const meses = Math.max(0, Math.round((new Date(m.prazo) - new Date()) / (1000 * 60 * 60 * 24 * 30)));
            if (meses > 0) faltaMes = `Guardar ${money(Math.max(0, (m.alvo - (m.guardado || 0)) / meses))}/mês para atingir até ${m.prazo.split('-').reverse().join('/')}`;
          }
          return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow-sm)">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <div><div style="font-size:14px;font-weight:700;color:var(--text)">${esc(m.nome)}</div><div style="font-size:11px;color:var(--text3)">${faltaMes}</div></div>
              <div style="text-align:right"><div style="font-size:16px;font-weight:800;font-family:'DM Mono',monospace;color:var(--text)">${money(m.guardado || 0)} / ${money(m.alvo)}</div><div style="font-size:10px;color:var(--text3)">${pct(prog)}</div></div>
            </div>
            <div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${(prog * 100).toFixed(0)}%;background:${prog >= 1 ? '#16a34a' : 'var(--accent)'}"></div></div>
            <div style="margin-top:10px;text-align:right">
              <button class="fin-meta-add" data-id="${m.id}" style="background:none;border:1px solid #86efac;color:#16a34a;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer;margin-right:4px">+ Guardar</button>
              <button class="fin-meta-del" data-id="${m.id}" style="background:none;border:1px solid #fca5a5;color:#dc2626;border-radius:4px;padding:4px 10px;font-size:11px;cursor:pointer">Excluir</button>
            </div>
          </div>`;
        }).join('')}
      </div>` : emptyBox('Nenhuma meta cadastrada. Crie objetivos: carro, viagem, capital de giro da A2Z...')}
    `;

    document.getElementById('fin-add-meta').addEventListener('click', () => {
      modal('Nova meta', `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1">${fLabel('Nome da meta')}<input id="g-nome" placeholder="Ex: Reserva carro, Viagem, Capital A2Z" style="${inp()}"/></div>
          <div>${fLabel('Valor alvo (R$)')}<input id="g-alvo" placeholder="0,00" style="${inp()}"/></div>
          <div>${fLabel('Já guardado (R$)')}<input id="g-guard" placeholder="0,00" style="${inp()}"/></div>
          <div style="grid-column:1/-1">${fLabel('Prazo (opcional)')}<input id="g-prazo" type="date" style="${inp()}"/></div>
        </div>`, () => {
        const nome = document.getElementById('g-nome').value.trim();
        if (!nome) { toast('Informe o nome', 'error'); return false; }
        const num = (id) => parseFloat(String(document.getElementById(id).value).replace(/\./g, '').replace(',', '.')) || 0;
        _data.metas.push({ id: uid(), escopo: _escopo, nome, alvo: num('g-alvo'), guardado: num('g-guard'), prazo: document.getElementById('g-prazo').value || null });
        saveData(); renderView(); return true;
      });
    });
    document.getElementById('fin-cfg-reserva').addEventListener('click', async () => {
      const v = await (window.nexusPrompt ? window.nexusPrompt('Quantos meses de gasto na reserva?', String(alvoMeses)) : Promise.resolve(prompt('Meses de reserva:', String(alvoMeses))));
      const n = parseInt(v); if (n > 0) { _data.config.reservaMeses = n; saveData(); renderView(); }
    });
    el.querySelectorAll('.fin-meta-add').forEach(b => b.addEventListener('click', async () => {
      const m = _data.metas.find(x => x.id === b.dataset.id); if (!m) return;
      const v = await (window.nexusPrompt ? window.nexusPrompt('Quanto guardar nesta meta? (R$)', '') : Promise.resolve(prompt('Valor a guardar (R$):')));
      const n = parseFloat(String(v || '').replace(/\./g, '').replace(',', '.')) || 0;
      if (n) { m.guardado = (Number(m.guardado) || 0) + n; saveData(); renderView(); }
    }));
    el.querySelectorAll('.fin-meta-del').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmar('Excluir esta meta?'))) return;
      _data.metas = _data.metas.filter(x => x.id !== b.dataset.id);
      saveData(); renderView();
    }));
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Init público (chamado pelo switchTab)
  // ════════════════════════════════════════════════════════════════════════
  window.financeiroInit = function () {
    if (!_initialized) { _initialized = true; }
    render();
  };
})();

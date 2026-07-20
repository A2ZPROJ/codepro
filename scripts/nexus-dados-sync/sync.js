#!/usr/bin/env node
/**
 * Agente de sincronização NEXUS-DADOS → Supabase.
 *
 * Sobe os JSONs de `_APOIO\NEXUS-DADOS` (análises do EEE, cotações, fornecedores)
 * para a tabela `nexus_dados`, de onde o Nexus lê em QUALQUER máquina — sem depender
 * do caminho local, do nome da biblioteca do SharePoint nem de VPN.
 *
 * Roda na máquina que TEM a pasta sincronizada (PREDATOR ou o servidor), 2x/dia
 * via Agendador de Tarefas. É idempotente: só envia o que mudou (sha256).
 *
 * Uso:
 *   set SUPABASE_SERVICE_ROLE_KEY=...
 *   node sync.js                 # usa a pasta achada automaticamente
 *   node sync.js --dir "<pasta>" # força a pasta
 *   node sync.js --dry           # só mostra o que faria
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xszpzsmdpbgaiodeqcpi.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASTAS = ['NEXUS-ANALISES', 'COTACOES NEXUS', 'FORNECEDORES NEXUS'];
const DRY = process.argv.includes('--dry');

function log(...a) { console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a); }

// ── acha a pasta (mesma lógica tolerante do app) ───────────────────────────────
function oneDriveRoots() {
  const roots = [];
  const add = p => { try { if (p && fs.existsSync(p) && !roots.includes(p)) roots.push(p); } catch {} };
  add(process.env.NEXUS_DADOS_DIR && path.dirname(process.env.NEXUS_DADOS_DIR));
  add(process.env.NEXUS_ONEDRIVE_2S);
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\OneDrive\\Accounts', '/s'], { encoding: 'utf8', windowsHide: true });
    for (const preferido of [true, false])
      for (const b of out.split(/\r?\n\s*\r?\n/)) {
        if (/2S ENGENHARIA/i.test(b) !== preferido) continue;
        const m = b.match(/UserFolder\s+REG_SZ\s+(.+?)\s*$/mi);
        if (m) add(m[1].trim());
      }
  } catch {}
  try { for (const n of fs.readdirSync(os.homedir())) if (/^OneDrive/i.test(n)) add(path.join(os.homedir(), n)); } catch {}
  return roots;
}
const ehPastaDados = p => { try { return PASTAS.some(s => fs.existsSync(path.join(p, s))); } catch { return false; } };
function acharPasta() {
  const i = process.argv.indexOf('--dir');
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.NEXUS_DADOS_DIR && ehPastaDados(process.env.NEXUS_DADOS_DIR)) return process.env.NEXUS_DADOS_DIR;
  const sufixos = [
    path.join('002. ACCIONA', '001. BLOCO 02', '_APOIO', 'NEXUS-DADOS'),
    path.join('001. BLOCO 02', '_APOIO', 'NEXUS-DADOS'),
    path.join('_APOIO', 'NEXUS-DADOS'),
    'NEXUS-DADOS',
  ];
  for (const root of oneDriveRoots()) {
    const bases = [root];
    try { for (const n of fs.readdirSync(root)) bases.push(path.join(root, n)); } catch {}
    for (const b of bases) for (const s of sufixos) {
      const p = path.join(b, s);
      try { if (fs.existsSync(p) && ehPastaDados(p)) return p; } catch {}
    }
  }
  const legacy = '\\\\2s-eng-servidor\\maringa\\_PROGRAMAS';
  if (ehPastaDados(legacy)) return legacy;
  return null;
}

// ── REST do Supabase (sem dependência externa) ────────────────────────────────
async function rest(metodo, caminho, corpo, extraHeaders) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${caminho} → HTTP ${r.status}: ${txt.slice(0, 400)}`);
  return txt ? JSON.parse(txt) : null;
}

(async () => {
  if (!SERVICE_KEY) { console.error('ERRO: defina SUPABASE_SERVICE_ROLE_KEY no ambiente.'); process.exit(2); }
  const dir = acharPasta();
  if (!dir) { console.error('ERRO: não achei a pasta NEXUS-DADOS nesta máquina.'); process.exit(3); }
  log('pasta:', dir);

  // o que já está no banco (só chave + sha, é leve)
  const remoto = new Map();
  try {
    for (const r of await rest('GET', 'nexus_dados?select=pasta,nome,sha256')) remoto.set(r.pasta + '|' + r.nome, r.sha256);
  } catch (e) {
    console.error('ERRO lendo a tabela nexus_dados —', e.message);
    console.error('A tabela existe? Rode supabase/sql-historico/2026-07-20_nexus_dados.sql no SQL Editor.');
    process.exit(4);
  }

  const enviar = []; let iguais = 0, invalidos = 0, vistos = 0;
  for (const sub of PASTAS) {
    const d = path.join(dir, sub);
    let arquivos = [];
    try { arquivos = fs.readdirSync(d).filter(n => n.toLowerCase().endsWith('.json')); } catch { continue; }
    for (const nome of arquivos) {
      if (/\.bak[-.]/i.test(nome)) continue;                       // ignora backups
      const p = path.join(d, nome);
      let bruto;
      try { bruto = fs.readFileSync(p, 'utf8'); } catch { continue; }
      vistos++;
      let conteudo;
      try { conteudo = JSON.parse(bruto); } catch { invalidos++; log('  ! JSON inválido, pulando:', sub + '/' + nome); continue; }
      const sha = crypto.createHash('sha256').update(bruto).digest('hex');
      if (remoto.get(sub + '|' + nome) === sha) { iguais++; continue; }
      enviar.push({ pasta: sub, nome, conteudo, sha256: sha, tamanho: Buffer.byteLength(bruto),
                    origem: `${os.hostname()}/${os.userInfo().username}`, atualizado_em: new Date().toISOString() });
    }
  }
  log(`arquivos: ${vistos} | já iguais: ${iguais} | a enviar: ${enviar.length}` + (invalidos ? ` | inválidos: ${invalidos}` : ''));
  for (const e of enviar) log('   →', e.pasta + '/' + e.nome, `(${e.tamanho} B)`);
  if (DRY) { log('DRY-RUN, nada foi enviado.'); return; }

  if (enviar.length) {
    for (let i = 0; i < enviar.length; i += 20) {
      await rest('POST', 'nexus_dados', enviar.slice(i, i + 20),
                 { Prefer: 'resolution=merge-duplicates,return=minimal' });
    }
    log('enviados', enviar.length);
  }
  await rest('POST', 'nexus_dados_sync', [{ id: 1, rodou_em: new Date().toISOString(),
              origem: `${os.hostname()}/${os.userInfo().username}`, arquivos: vistos,
              detalhe: { enviados: enviar.length, iguais, invalidos, pasta: dir } }],
             { Prefer: 'resolution=merge-duplicates,return=minimal' });
  log('OK');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });

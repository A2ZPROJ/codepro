/* nexus-office-push.js — avisa o Escritorio Virtual (Builder) quando o Nexus e publicado.
   Roda como postbuild:publish (so dispara se o publish terminou OK).
   Node puro, sem dependencias. NUNCA derruba o publish (sai 0 em qualquer erro). */
const fs = require('fs');
const path = require('path');

const STATUS = 'C:\\Users\\lcabd\\jarvis\\nexus-escritorio\\nexus_status.js';

function appVersion() {
  try { return require('../package.json').version; } catch { return '?'; }
}
function dllVersion() {
  try {
    const csproj = 'D:\\PROGRAMAÇÃO\\NETLOAD CIVIL 3D\\OSE_Reconectar.csproj';
    const m = fs.readFileSync(csproj, 'utf8').match(/<Version>([^<]+)<\/Version>/);
    return m ? m[1] : null;
  } catch { return null; }
}

function push(who, txt) {
  const raw = fs.readFileSync(STATUS, 'utf8');
  const m = raw.match(/window\.NEXUS_STATUS\s*=\s*(\{[\s\S]*\})\s*;/);
  if (!m) throw new Error('NEXUS_STATUS nao encontrado');
  const o = JSON.parse(m[1]);
  o.feed = (o.feed || []).concat([{ who, txt }]).slice(-40);
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  o.updated = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const out = '/* Status REAL (Fase 2) — escrito por nexus-office-push.js */\nwindow.NEXUS_STATUS = ' + JSON.stringify(o, null, 2) + ';\n';
  fs.writeFileSync(STATUS, out, 'utf8');
}

try {
  const app = appVersion();
  const dll = dllVersion();
  const txt = dll ? `publicou Nexus v${app} / DLL ${dll} (OK)` : `publicou Nexus v${app} (OK)`;
  push('Builder', txt);
  console.log('[escritorio] Builder: ' + txt);
} catch (e) {
  console.warn('[escritorio] aviso ignorado (publish nao afetado):', e.message);
}
process.exit(0);

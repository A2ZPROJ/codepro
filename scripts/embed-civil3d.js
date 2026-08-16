// embed-civil3d.js
// Lê as DLLs GerarProjetoMND.dll do projeto NETLOAD (multi-target), criptografa
// cada uma com AES-256-GCM, e grava um blob por versão de Civil 3D em
// src/app/assets/:
//   civil3d-2026.bin  <- bin/Release/net8.0-windows  (Civil 3D 2026, .NET 8)
//   civil3d-2027.bin  <- bin/Release/net10.0-windows (Civil 3D 2027, .NET 10)
//
// Formato do arquivo (por blob):
//   [4 bytes ] magic "NXC3"
//   [1 byte  ] version (1)
//   [12 bytes] IV (GCM)
//   [16 bytes] auth tag (GCM)
//   [4 bytes ] dll size (uint32 LE)
//   [N bytes ] ciphertext
//
// Rodar antes de cada build do Nexus:  node scripts/embed-civil3d.js
//
// Importante: a chave AES é derivada de uma string fixa via SHA-256.
// Combinada com o javascript-obfuscator (rodado no precompile),
// extrair a chave do bundle requer engenharia reversa não trivial.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Raízes candidatas do projeto NETLOAD (varia por máquina: ACER em C:, PREDATOR
// em D:). A primeira que existir e tiver bin/Release é usada.
const BUILD_ROOTS = [
  'C:/PROGRAMAÇÃO/NETLOAD',
  'D:/PROGRAMAÇÃO/NETLOAD',
  'D:/PROGRAMAÇÃO/NETLOAD CIVIL 3D',
  'D:/PROGRAMACAO/NETLOAD',
];

// Um alvo por versão do CAD: framework de build -> blob de saída + subpasta de deps.
const TARGETS = [
  { ver: '2026', tfm: 'net8.0-windows',  bin: 'civil3d-2026.bin' },
  { ver: '2027', tfm: 'net10.0-windows', bin: 'civil3d-2027.bin' },
];

const ASSETS_DIR    = path.resolve(__dirname, '..', 'src', 'app', 'assets');
const DEPS_OUT_ROOT = path.resolve(ASSETS_DIR, 'civil3d-deps');

// DLLs públicas (Microsoft WebView2 + runtimes) — copiadas sem criptografia
// pro bundle, junto com a DLL principal. O WebView2 precisa do loader nativo
// pra inicializar dentro do Civil 3D.
const PUBLIC_DEPS = [
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'Microsoft.Web.WebView2.Wpf.dll',
  'runtimes/win-x64/native/WebView2Loader.dll',
  // Monitoramento de erros do plugin (SentryMonitor.cs). DLL pública, sem
  // segredo — vai em claro junto da DLL principal. Sem deps transitivas
  // (System.Text.Json etc. são in-box no .NET 8/10).
  'Sentry.dll',
  // SQLite — o IMPORTAREDEMODELO / MAPAMODELO leem o banco do SewerGEMS (.sqlite)
  // direto. SEM estas 5 o comando de importar o modelo QUEBRA na maquina do usuario
  // (o resto do plugin continua funcionando, o que disfarcava o problema).
  // Ate 28/07 so a copia DEV do build levava estas DLLs pro bundle; o publish NAO —
  // por isso Murilo/Camila/Katia nao conseguiam importar o modelo. NAO REMOVER.
  'Microsoft.Data.Sqlite.dll',
  'SQLitePCLRaw.batteries_v2.dll',
  'SQLitePCLRaw.core.dll',
  'SQLitePCLRaw.provider.e_sqlite3.dll',
  // nativo: no build fica em runtimes\win-x64\native, mas o plugin carrega da RAIZ
  { from: 'runtimes/win-x64/native/e_sqlite3.dll', to: 'e_sqlite3.dll' },
];

// Mesma constante usada em src/main.js no decrypt — NÃO ALTERAR
// sem rebuildar as DLLs embedded também.
const KEY_SEED = 'NexusCivil3D-A2Z-Embed-2026-v1-SecureKeyDerivation';

function deriveKey(seed) {
  return crypto.createHash('sha256').update(seed, 'utf8').digest();
}

function encryptDll(plainBuf) {
  const key = deriveKey(KEY_SEED);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();

  const magic = Buffer.from('NXC3', 'ascii');
  const version = Buffer.from([1]);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(plainBuf.length, 0);

  return Buffer.concat([magic, version, iv, tag, sizeBuf, ciphertext]);
}

// Acha bin/Release/<tfm>/GerarProjetoMND.dll na primeira raiz que existir.
function findDll(tfm) {
  for (const root of BUILD_ROOTS) {
    const p = path.resolve(root, 'bin', 'Release', tfm, 'GerarProjetoMND.dll');
    if (fs.existsSync(p)) return { dll: p, buildDir: path.dirname(p) };
  }
  return null;
}

// mtime da DLL-fonte de cada alvo — usado no fim pra garantir que 2026 e 2027
// vieram do MESMO build.
const mtimes = [];

function embedTarget(t) {
  const found = findDll(t.tfm);
  const outFile = path.resolve(ASSETS_DIR, t.bin);
  const depsDir = path.resolve(DEPS_OUT_ROOT, t.ver);

  if (!found) {
    // DLL-fonte ausente (ex.: máquina sem aquele CAD/build). Se o .bin já existe
    // versionado, reusa em vez de abortar — permite publicar mexendo só no app.
    if (fs.existsSync(outFile) && fs.existsSync(depsDir)) {
      console.warn(`[embed-civil3d] (${t.ver}) DLL-fonte ausente — reusando ${t.bin} existente`);
      return { ok: true, reused: true };
    }
    console.warn(`[embed-civil3d] (${t.ver}) DLL não encontrada (${t.tfm}) e sem blob prévio — PULANDO`);
    return { ok: false, missing: true };
  }

  mtimes.push({ ver: t.ver, mtime: fs.statSync(found.dll).mtimeMs });

  const dll = fs.readFileSync(found.dll);
  const blob = encryptDll(dll);
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(outFile, blob);

  const sha = crypto.createHash('sha256').update(dll).digest('hex').slice(0, 16);
  console.log(`[embed-civil3d] (${t.ver}) DLL embedded`);
  console.log(`  fonte:   ${found.dll}`);
  console.log(`  destino: ${outFile}`);
  console.log(`  tamanho: ${dll.length} bytes -> ${blob.length} crypt | sha256[0..16]: ${sha}`);

  // Limpa deps-dir da versão e copia DLLs públicas (WebView2)
  if (fs.existsSync(depsDir)) fs.rmSync(depsDir, { recursive: true, force: true });
  fs.mkdirSync(depsDir, { recursive: true });
  let copied = 0;
  for (const dep of PUBLIC_DEPS) {
    // aceita 'caminho/rel.dll' ou { from, to } (quando o destino muda de lugar)
    const rel = typeof dep === 'string' ? dep : dep.from;
    const destRel = typeof dep === 'string' ? dep : dep.to;
    const src = path.resolve(found.buildDir, rel);
    const dst = path.resolve(depsDir, destRel);
    if (!fs.existsSync(src)) { console.warn(`[embed-civil3d] (${t.ver}) dep faltando: ${rel}`); continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  console.log(`  deps:    ${copied}/${PUBLIC_DEPS.length} -> ${depsDir}`);
  return { ok: true };
}

function main() {
  let anyOk = false;
  const problemas = [];
  for (const t of TARGETS) {
    const r = embedTarget(t);
    if (r.ok) anyOk = true;
    if (r.reused) problemas.push(`${t.ver}: reusou blob ANTIGO (build ${t.tfm} não existe)`);
    if (r.missing) problemas.push(`${t.ver}: sem DLL e sem blob — versão FORA do instalador`);
  }
  if (!anyOk) {
    console.error('[embed-civil3d] ERRO — nenhuma DLL encontrada nem blob prévio.');
    console.error('  Rode `dotnet build OSE_Reconectar.csproj -c Release` no projeto NETLOAD antes.');
    process.exit(1);
  }

  // Os dois TFMs têm que vir do MESMO build. Se um deles ficou pra trás, o
  // instalador sai com uma versão de DLL em cada pasta e o usuário de uma das
  // versões de CAD nunca recebe a correção — sem nenhum erro aparecendo.
  if (mtimes.length === TARGETS.length) {
    const dt = Math.abs(mtimes[0].mtime - mtimes[1].mtime) / 1000;
    if (dt > 300) {
      problemas.push(`builds de TFM diferentes: ${mtimes.map(m => m.ver).join(' x ')} ` +
                     `separados por ${Math.round(dt / 60)} min`);
    }
  }

  if (problemas.length) {
    console.error('\n[embed-civil3d] ERRO — as DUAS versões de CAD (2026 e 2027) precisam sair');
    console.error('do mesmo build. Publicar assim entrega DLL velha pra uma delas:');
    for (const p of problemas) console.error('  · ' + p);
    console.error('\n  Rode `dotnet build "OSE_Reconectar.csproj" -c Release` (SEM -f) e repita.');
    console.error('  Pra publicar mesmo assim, de propósito: NEXUS_EMBED_ALLOW_PARCIAL=1');
    if (process.env.NEXUS_EMBED_ALLOW_PARCIAL !== '1') process.exit(1);
    console.error('  (NEXUS_EMBED_ALLOW_PARCIAL=1 — seguindo mesmo assim)');
  }

  console.log(`\n[embed-civil3d] OK — 2026 e 2027 embutidos do mesmo build.`);
}

main();

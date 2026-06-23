// embed-civil3d.js
// Lê o GerarProjetoMND.dll do projeto NETLOAD CIVIL 3D, criptografa com
// AES-256-GCM, e grava o blob em src/app/assets/civil3d.bin.
//
// Formato do arquivo:
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

const BUILD_DIR = 'D:/PROGRAMAÇÃO/NETLOAD CIVIL 3D/bin/Release/net8.0-windows';
const DLL_SOURCE = path.resolve(BUILD_DIR, 'GerarProjetoMND.dll');
const OUT_FILE = path.resolve(__dirname, '..', 'src', 'app', 'assets', 'civil3d.bin');
const DEPS_OUT_DIR = path.resolve(__dirname, '..', 'src', 'app', 'assets', 'civil3d-deps');

// DLLs públicas (Microsoft WebView2 + runtimes) — copiadas sem criptografia
// pro bundle, junto com a DLL principal. O WebView2 precisa do loader nativo
// pra inicializar dentro do Civil 3D.
const PUBLIC_DEPS = [
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'Microsoft.Web.WebView2.Wpf.dll',
  'runtimes/win-x64/native/WebView2Loader.dll',
];

// Mesma constante usada em src/app/index.html no decrypt — NÃO ALTERAR
// sem rebuildar a DLL embedded também.
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

function main() {
  if (!fs.existsSync(DLL_SOURCE)) {
    console.error('[embed-civil3d] ERRO — DLL não encontrada em:', DLL_SOURCE);
    console.error('[embed-civil3d] Rode `dotnet build -c Release` no projeto NETLOAD CIVIL 3D antes.');
    process.exit(1);
  }

  const dll = fs.readFileSync(DLL_SOURCE);
  const blob = encryptDll(dll);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, blob);

  const sha = crypto.createHash('sha256').update(dll).digest('hex').slice(0, 16);
  console.log(`[embed-civil3d] DLL embedded com sucesso`);
  console.log(`  fonte:  ${DLL_SOURCE}`);
  console.log(`  destino: ${OUT_FILE}`);
  console.log(`  tamanho original: ${dll.length} bytes`);
  console.log(`  tamanho criptografado: ${blob.length} bytes`);
  console.log(`  sha256[0..16]: ${sha}`);

  // Limpa deps-dir e copia DLLs públicas (WebView2)
  if (fs.existsSync(DEPS_OUT_DIR)) fs.rmSync(DEPS_OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(DEPS_OUT_DIR, { recursive: true });
  let copied = 0;
  for (const rel of PUBLIC_DEPS) {
    const src = path.resolve(BUILD_DIR, rel);
    const dst = path.resolve(DEPS_OUT_DIR, rel);
    if (!fs.existsSync(src)) {
      console.warn(`[embed-civil3d] dep faltando: ${rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  console.log(`[embed-civil3d] ${copied}/${PUBLIC_DEPS.length} deps copiadas pra ${DEPS_OUT_DIR}`);
}

main();

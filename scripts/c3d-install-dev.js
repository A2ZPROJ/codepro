// c3d-install-dev.js
// Instala as DLLs Civil 3D direto no bundle do Nexus, sem precisar abrir o app
// nem publicar uma release nova. Usa os blobs criptografados gerados pelo
// embed-civil3d.js (civil3d-2026.bin / civil3d-2027.bin), descriptografa com a
// mesma chave do main.js e escreve em
//   %APPDATA%\Autodesk\ApplicationPlugins\Nexus.bundle\Contents\Civil3D\<ver>\
// montando um PackageContents.xml com um bloco por versão (o AutoCAD escolhe).
//
// Importante: o Civil 3D daquela versão NÃO PODE ESTAR ABERTO (o write da DLL
// dá EBUSY). Feche o CAD antes. Versões com CAD aberto são puladas.
//
// Uso: node scripts/c3d-install-dev.js
//
// O path-binding do AntiTamper aceita %APPDATA%\Autodesk\ApplicationPlugins\Nexus.bundle\
// então a DLL carrega normal pelo loader do Civil 3D.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const KEY_SEED = 'NexusCivil3D-A2Z-Embed-2026-v1-SecureKeyDerivation';

// Mesma tabela de versões do main.js.
const TARGETS = [
  { ver: '2026', blob: 'civil3d-2026.bin', seriesMin: 'R25.1', seriesMax: 'R25.1' },
  { ver: '2027', blob: 'civil3d-2027.bin', seriesMin: 'R26.0', seriesMax: 'R26.0' },
];

const ASSETS_DIR = path.resolve(__dirname, '..', 'src', 'app', 'assets');
const DEPS_ROOT  = path.resolve(ASSETS_DIR, 'civil3d-deps');
const BUNDLE_ROOT = path.join(os.homedir(), 'AppData', 'Roaming', 'Autodesk', 'ApplicationPlugins', 'Nexus.bundle');
const BUNDLE_CONTENTS = path.join(BUNDLE_ROOT, 'Contents', 'Civil3D');
const BUNDLE_XML = path.join(BUNDLE_ROOT, 'PackageContents.xml');
const BUNDLE_VERSION_FILE = path.join(BUNDLE_ROOT, 'Version.txt');

function deriveKey() {
  return crypto.createHash('sha256').update(KEY_SEED, 'utf8').digest();
}

function decryptBlob(blob) {
  if (blob.length < 4 + 1 + 12 + 16 + 4) throw new Error('blob inválido');
  const magic = blob.slice(0, 4).toString('ascii');
  if (magic !== 'NXC3') throw new Error('blob com magic incorreto');
  const version = blob[4];
  if (version !== 1) throw new Error('versão do blob não suportada: ' + version);
  const iv  = blob.slice(5, 17);
  const tag = blob.slice(17, 33);
  const size = blob.readUInt32LE(33);
  const ciphertext = blob.slice(37);

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (plain.length !== size) throw new Error('tamanho descriptografado incorreto');
  return plain;
}

function copyDeps(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  const walk = (src, dst) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) { fs.mkdirSync(d, { recursive: true }); walk(s, d); }
      else { try { fs.copyFileSync(s, d); } catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; } }
    }
  };
  walk(srcDir, destDir);
}

function buildPackageContents(version, vers) {
  const blocks = vers.map(ver => {
    const t = TARGETS.find(x => x.ver === ver);
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
</ApplicationPackage>`;
}

function main() {
  const version = require('../package.json').version || '0.0.0';
  const installedVers = [];
  let busy = false;

  for (const t of TARGETS) {
    const blobPath = path.resolve(ASSETS_DIR, t.blob);
    if (!fs.existsSync(blobPath)) {
      console.warn(`[c3d-install-dev] (${t.ver}) blob ausente (${t.blob}) — pulando`);
      continue;
    }
    let dll;
    try { dll = decryptBlob(fs.readFileSync(blobPath)); }
    catch (e) { console.error(`[c3d-install-dev] (${t.ver}) erro descriptando: ${e.message}`); continue; }

    const dir = path.join(BUNDLE_CONTENTS, t.ver);
    fs.mkdirSync(dir, { recursive: true });
    const dllPath = path.join(dir, 'GerarProjetoMND.dll');
    try {
      fs.writeFileSync(dllPath, dll);
    } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        console.warn(`[c3d-install-dev] (${t.ver}) Civil 3D ABERTO — pulando (feche o CAD ${t.ver} e rode de novo)`);
        busy = true;
        continue;
      }
      throw e;
    }
    copyDeps(path.join(DEPS_ROOT, t.ver), dir);
    const sha = crypto.createHash('sha256').update(dll).digest('hex').slice(0, 16);
    console.log(`[c3d-install-dev] (${t.ver}) DLL instalada — ${dll.length} bytes | sha ${sha} -> ${dllPath}`);
    installedVers.push(t.ver);
  }

  if (installedVers.length === 0) {
    console.error('[c3d-install-dev] ERRO — nenhuma versão instalada (blobs ausentes ou CAD aberto).');
    process.exit(busy ? 2 : 1);
  }

  fs.writeFileSync(BUNDLE_XML, buildPackageContents(version, installedVers));
  if (!busy) fs.writeFileSync(BUNDLE_VERSION_FILE, version + '\n');

  console.log('');
  console.log(`[c3d-install-dev] bundle v${version} pronto — versões: ${installedVers.join(', ')}${busy ? ' (parcial)' : ''}`);
  console.log('Abra o Civil 3D e os comandos novos vão aparecer na ribbon NEXUS.');
}

main();

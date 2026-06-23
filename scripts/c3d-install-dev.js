// c3d-install-dev.js
// Instala a DLL Civil 3D direto no bundle do Nexus, sem precisar abrir o app
// nem publicar uma release nova. Usa o civil3d.bin (criptografado) gerado pelo
// embed-civil3d.js, descriptografa com a mesma chave do main.js, e escreve em
//   %APPDATA%\Autodesk\ApplicationPlugins\Nexus.bundle\Contents\Civil3D\2026\
//
// Importante: o Civil 3D NÃO PODE ESTAR ABERTO (o write da DLL dá EBUSY se
// estiver). Feche o CAD antes.
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

const BLOB_PATH = path.resolve(__dirname, '..', 'src', 'app', 'assets', 'civil3d.bin');
const BUNDLE_ROOT = path.join(os.homedir(), 'AppData', 'Roaming', 'Autodesk', 'ApplicationPlugins', 'Nexus.bundle');
const BUNDLE_DLL_DIR = path.join(BUNDLE_ROOT, 'Contents', 'Civil3D', '2026');
const BUNDLE_DLL = path.join(BUNDLE_DLL_DIR, 'GerarProjetoMND.dll');
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

function buildPackageContents(version) {
  return `<?xml version="1.0" encoding="utf-8"?>
<ApplicationPackage SchemaVersion="1.0"
    ProductType="Application"
    Name="Nexus"
    AppVersion="${version}"
    Description="Nexus Civil 3D Plugin — A2Z Projetos"
    Author="Lucas Nasser Santos Abdala">
  <CompanyDetails Name="A2Z Projetos" />
  <Components Description="Nexus Civil 3D 2026">
    <RuntimeRequirements
        OS="Win64"
        Platform="Civil3D"
        SeriesMin="R25.1"
        SeriesMax="R25.1" />
    <ComponentEntry
        AppName="Nexus"
        Version="${version}"
        ModuleName="./Contents/Civil3D/2026/GerarProjetoMND.dll"
        AppDescription="Nexus Civil 3D Plugin"
        LoadOnAutoCADStartup="True"
        PerDocument="True" />
  </Components>
</ApplicationPackage>`;
}

function main() {
  if (!fs.existsSync(BLOB_PATH)) {
    console.error('[c3d-install-dev] ERRO — civil3d.bin não encontrado em:', BLOB_PATH);
    console.error('  Rode antes: npm run embed-civil3d');
    process.exit(1);
  }

  const version = require('../package.json').version || '0.0.0';
  const blob = fs.readFileSync(BLOB_PATH);

  let dll;
  try { dll = decryptBlob(blob); }
  catch (e) {
    console.error('[c3d-install-dev] ERRO descriptando blob:', e.message);
    process.exit(1);
  }

  fs.mkdirSync(BUNDLE_DLL_DIR, { recursive: true });

  try {
    fs.writeFileSync(BUNDLE_DLL, dll);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM') {
      console.error('[c3d-install-dev] ERRO — Civil 3D está aberto. Feche o CAD e rode de novo.');
      process.exit(2);
    }
    throw e;
  }

  fs.writeFileSync(BUNDLE_XML, buildPackageContents(version));
  fs.writeFileSync(BUNDLE_VERSION_FILE, version + '\n');

  const sha = crypto.createHash('sha256').update(dll).digest('hex').slice(0, 16);
  console.log('[c3d-install-dev] DLL instalada no bundle');
  console.log('  versão:  v' + version);
  console.log('  destino: ' + BUNDLE_DLL);
  console.log('  tamanho: ' + dll.length + ' bytes');
  console.log('  sha256[0..16]: ' + sha);
  console.log('');
  console.log('Agora: abra o Civil 3D 2026 e os comandos novos vão aparecer na ribbon NEXUS.');
}

main();

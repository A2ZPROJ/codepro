const crypto = require('crypto');

// Secret ofuscado — não armazena em texto plano no source.
// Decodificado em runtime via Buffer.from(base64) XOR com salt fixo.
const _s = Buffer.from('FWUgMCA2JyUhe1YFVFNJ', 'base64');
const _k = [0x54, 0x57, 0x7A, 0x73, 0x6F, 0x72, 0x62, 0x75, 0x73, 0x34, 0x64, 0x35, 0x66, 0x67, 0x68, 0x21];
const SECRET = Buffer.from(_s.map((b, i) => b ^ _k[i % _k.length])).toString('utf8').replace(/\0+$/, '');
const EPOCH = new Date('2024-01-01');
const ROLES = ['visualizador','criador','desenvolvedor','master'];
const ROLES_LABEL = ['Visualizador','Criador','Desenvolvedor','Master'];
const ROLES_COLOR = ['#d97706','#059669','#2563eb','#7c3aed'];
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function hmacHash(data){
  return crypto.createHmac('sha256', SECRET).update(data).digest();
}

function toB32(buf){
  let bits = '';
  for(const b of buf) bits += b.toString(2).padStart(8,'0');
  while(bits.length % 5 !== 0) bits += '0';
  let result = '';
  for(let i=0;i<bits.length;i+=5) result += ALPHA[parseInt(bits.slice(i,i+5),2)];
  return result;
}

function fromB32(str){
  let bits = '';
  for(const c of str.toUpperCase()){
    const idx = ALPHA.indexOf(c);
    if(idx < 0) throw new Error('Invalid char: '+c);
    bits += idx.toString(2).padStart(5,'0');
  }
  const bytes = [];
  for(let i=0;i+8<=bits.length;i+=8) bytes.push(parseInt(bits.slice(i,i+8),2));
  return Buffer.from(bytes);
}

function encode(name, company, role, expireDate){
  const roleId = Math.max(0, ROLES.indexOf(role.toLowerCase()));
  const days = Math.floor((new Date(expireDate) - EPOCH) / 86400000);
  const payload = Buffer.alloc(3);
  payload.writeUInt8(roleId, 0);
  payload.writeUInt16BE(days, 1);
  const nameHash = hmacHash(name.toLowerCase()).slice(0,2);
  const compHash = hmacHash(company.toLowerCase()).slice(0,2);
  const salt = crypto.createHash('sha256').update(name+company+days).digest().slice(0,1);
  const raw = Buffer.concat([payload, nameHash, compHash, salt]);
  let s = 0; for(const b of raw) s = (s+b) % 65536;
  const cksum = Buffer.alloc(2); cksum.writeUInt16BE(s,0);
  const full = Buffer.concat([raw, cksum]);
  const encoded = toB32(full).slice(0,16);
  return encoded.replace(/(.{4})/g,'$1-').slice(0,-1);
}

function decode(key, name, company){
  try {
    const clean = key.replace(/[-\s]/g,'').toUpperCase().slice(0,16);
    if(clean.length !== 16) return {valid:false, error:'Código deve ter 16 caracteres (XXXX-XXXX-XXXX-XXXX)'};
    const raw = fromB32(clean);
    if(raw.length < 10) return {valid:false, error:'Código inválido'};
    let s = 0; for(let i=0;i<8;i++) s = (s+raw[i]) % 65536;
    if(raw.readUInt16BE(8) !== s) return {valid:false, error:'Código de licença inválido'};
    const roleId = raw.readUInt8(0);
    const days = raw.readUInt16BE(1);
    const expire = new Date(EPOCH.getTime() + days * 86400000);
    const nameHash = hmacHash(name.toLowerCase()).slice(0,2);
    const compHash = hmacHash(company.toLowerCase()).slice(0,2);
    if(!raw.slice(3,5).equals(nameHash)) return {valid:false, error:'Nome de usuário não corresponde a esta licença'};
    if(!raw.slice(5,7).equals(compHash)) return {valid:false, error:'Empresa não corresponde a esta licença'};
    const today = new Date(); today.setHours(0,0,0,0);
    if(today > expire) return {valid:false, error:`Licença expirada em ${expire.toLocaleDateString('pt-BR')}`};
    const daysLeft = Math.ceil((expire - today) / 86400000);
    const idx = Math.min(roleId, 3);
    return {valid:true, role:ROLES[idx], roleLabel:ROLES_LABEL[idx], roleColor:ROLES_COLOR[idx], expire:expire.toLocaleDateString('pt-BR'), daysLeft};
  } catch(e){ return {valid:false, error:'Código de licença inválido'}; }
}

module.exports = { encode, decode, ROLES, ROLES_LABEL };

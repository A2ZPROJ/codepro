// Usage: node src/gen-license.js "Lucas Abdala" "A2Z Projetos" master 2030-12-21
const license = require('./license');

const [,, name, company, role, expireStr] = process.argv;

if(!name||!company||!role||!expireStr){
  console.log('Usage: node src/gen-license.js "Nome" "Empresa" role YYYY-MM-DD');
  console.log('Roles: visualizador, criador, desenvolvedor, master');
  process.exit(1);
}

const expireDate = new Date(expireStr);
const key = license.encode(name, company, role, expireDate);

console.log('\n=== LICENÇA GERADA ===');
console.log(`Nome:    ${name}`);
console.log(`Empresa: ${company}`);
console.log(`Nível:   ${role}`);
console.log(`Expira:  ${expireDate.toLocaleDateString('pt-BR')}`);
console.log(`\nCódigo:  ${key}\n`);

#!/usr/bin/env node
// Orquestrador do scraper de tabelas de preço.
// Uso:
//   node index.js                       → roda tudo (SANEPAR, SINAPI)
//   node index.js --only=sanepar        → roda só uma fonte
//   node index.js --dry-run             → não escreve no banco
//   node index.js --only=sinapi --dry-run
'use strict';

const { scrapeSanepar } = require('./lib/sanepar');
const { scrapeSinapi } = require('./lib/sinapi');

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    if (a.startsWith('--only=')) args.only = a.slice(7).toLowerCase();
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--uf=')) args.uf = a.slice(5).toUpperCase();
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = !!args.dryRun;
  const uf = args.uf || 'PR';

  // sinapi está desabilitado por default (Caixa bloqueia scraping).
  // Rodar explícito com --only=sinapi se quiser tentar.
  const all = [
    { name: 'sanepar', fn: () => scrapeSanepar({ dryRun }), defaultRun: true },
    { name: 'sinapi',  fn: () => scrapeSinapi({ dryRun, uf }), defaultRun: false },
  ];
  const tasks = args.only
    ? all.filter(t => t.name === args.only)
    : all.filter(t => t.defaultRun);
  if (!tasks.length) {
    console.error('Nenhuma task selecionada. Use --only=sanepar|sinapi');
    process.exit(2);
  }

  const results = [];
  for (const t of tasks) {
    console.log(`\n========= ${t.name.toUpperCase()} =========`);
    const started = Date.now();
    try {
      const r = await t.fn();
      const took = ((Date.now() - started) / 1000).toFixed(1);
      results.push({ fonte: t.name, ok: true, tempo_s: +took, ...r });
    } catch (e) {
      const took = ((Date.now() - started) / 1000).toFixed(1);
      console.error(`[${t.name}] ERRO:`, e.message);
      if (process.env.DEBUG) console.error(e.stack);
      results.push({ fonte: t.name, ok: false, tempo_s: +took, error: e.message });
    }
  }

  console.log('\n========= RESUMO =========');
  console.table(results);
  const anyFail = results.some(r => !r.ok);
  process.exit(anyFail ? 1 : 0);
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});

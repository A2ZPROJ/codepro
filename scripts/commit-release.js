#!/usr/bin/env node
// commit-release.js — roda no FIM do `build:publish`, DEPOIS do postrestore.
// Garante que toda release publicada (electron-builder --publish always) tenha
// o fonte correspondente commitado e a tag vX.Y.Z apontando pro commit certo.
//
// Histórico do problema: as releases v2.84.0..v2.84.16 foram publicadas sem
// commitar o fonte; todas as tags apontavam pro mesmo commit velho (v2.83.0).
// Isso deixava o código vivendo só no working dir (risco de perda total).
//
// Pré-condição: rodar APÓS o postrestore (restore-source.js), pra commitar o
// fonte legível e não o ofuscado.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

function git(args, opts = {}) {
  return execSync(`git ${args}`, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts }).trim();
}
function gitTry(args) {
  try { return { ok: true, out: git(args) }; }
  catch (e) { return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message }; }
}

// 0) é repo git?
if (!gitTry('rev-parse --is-inside-work-tree').ok) {
  console.warn('[commit-release] não é um repo git — pulando commit da release.');
  process.exit(0);
}

console.log(`[commit-release] preparando commit da release ${tag}...`);

// 1) stage tudo (o fonte já foi restaurado pelo postrestore)
git('add -A');

// 2) tem algo pra commitar?
const status = git('status --porcelain');
if (!status) {
  console.log('[commit-release] working tree limpo — nada novo pra commitar.');
} else {
  git(`commit -m "chore(release): ${tag}"`);
  console.log(`[commit-release] commit criado para ${tag}.`);
}

// 3) tag aponta pro commit atual (força mover se já existir localmente)
git(`tag -f ${tag}`);

// 4) push do branch atual + tag (força só a tag, pra alinhar tag==commit do fonte)
const branch = git('rev-parse --abbrev-ref HEAD');
const pushBranch = gitTry(`push origin ${branch}`);
if (!pushBranch.ok) {
  console.warn(`[commit-release] AVISO: push do branch ${branch} falhou (release já subiu; faça o push manual):\n${pushBranch.out}`);
}
const pushTag = gitTry(`push -f origin ${tag}`);
if (!pushTag.ok) {
  console.warn(`[commit-release] AVISO: push da tag ${tag} falhou:\n${pushTag.out}`);
}

console.log(`[commit-release] concluído: tag ${tag} == commit do fonte.`);

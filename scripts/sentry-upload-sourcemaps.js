#!/usr/bin/env node
/**
 * sentry-upload-sourcemaps.js — Sobe os source maps da ofuscação pro Sentry,
 * pra de-ofuscar os stacks (sem isso o stack do erro vem como `_0x1a2b(...)`).
 *
 * Roda no build:publish DEPOIS do electron-builder e ANTES do postrestore
 * (que apaga os .map). É NO-OP silencioso se faltar SENTRY_AUTH_TOKEN — assim
 * o publish nunca quebra por causa disso (quem não tem o token só não sobe map).
 *
 * Pré-requisitos:
 *   - compile-obfuscate.js já gerou src/*.js + src/*.js.map (sourceMappingURL embutido)
 *   - env SENTRY_AUTH_TOKEN com escopo project:releases (criar em
 *     sentry.io → Settings → Auth Tokens). Opcional: SENTRY_ORG / SENTRY_PROJECT.
 *
 * O `release` precisa BATER com o do Sentry.init() do main.js: `nexus@<versao>`.
 * O url-prefix `~/src` casa com o caminho que o @sentry/electron usa nos frames
 * (app:///src/...). Se a symbolicação não pegar, ajustar SENTRY_URL_PREFIX.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const TOKEN = process.env.SENTRY_AUTH_TOKEN || '';
const ORG = process.env.SENTRY_ORG || 'a2z-projetos';
const PROJECT = process.env.SENTRY_PROJECT || 'electron';
const URL_PREFIX = process.env.SENTRY_URL_PREFIX || '~/src';

function log(m) { console.log('[sentry-sourcemaps] ' + m); }

(async function main() {
  if (!TOKEN) {
    log('SENTRY_AUTH_TOKEN não definido — pulando upload de source maps (publish segue normal).');
    return;
  }

  // Confere se há .map gerados
  let maps = [];
  try {
    maps = fs.readdirSync(SRC).filter(f => f.endsWith('.js.map'));
  } catch {}
  if (!maps.length) {
    log('nenhum .map em src/ — nada a subir (a ofuscação rodou?).');
    return;
  }

  const version = (require(path.join(ROOT, 'package.json')).version || '0.0.0');
  const release = 'nexus@' + version;

  let SentryCli;
  try {
    SentryCli = require('@sentry/cli');
  } catch (e) {
    log('@sentry/cli não instalado (npm i -D @sentry/cli). Pulando. ' + (e && e.message));
    return;
  }

  const cli = new SentryCli(null, { authToken: TOKEN, org: ORG, project: PROJECT });

  try {
    log(`release=${release}  org=${ORG}  project=${PROJECT}  (${maps.length} maps)`);
    await cli.releases.new(release);
    await cli.releases.uploadSourceMaps(release, {
      include: [SRC],
      urlPrefix: URL_PREFIX,
      rewrite: true,
      ext: ['js', 'map'],
    });
    await cli.releases.finalize(release);
    log('source maps enviados e release finalizada ✓');
  } catch (e) {
    // Nunca aborta o publish por causa do Sentry.
    log('FALHOU o upload (publish segue): ' + (e && e.message));
  }
})();

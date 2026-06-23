// Testes do parseOse.js
// Os testes que precisam de fixtures DXF/XLSX reais estão marcados com .skip
// e devem ser ativados conforme as fixtures forem criadas (ver README.md).

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as helpers from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// parseOse.js é CommonJS; usar createRequire pra interop
const parseOseModule = require('../src/parseOse.js');
const {
  parseOse,
  parseMapaDxf,
  parsePerfisDxf,
  parseExcel,
  buildComparison,
} = parseOseModule;

const {
  fixturePath, makeDxfFromGroups, makeMtext, wrapEntities,
  buildOseWorkbook, writeTempXlsx, cleanupTempFile,
} = helpers;

// ──────────────────────────────────────────────────────────────────────────
// Funções internas (re-exportar pra testar puras seria ideal — por enquanto
// vamos testar comportamento via parsers de alto nível usando fixtures
// pequenas escritas em /tmp).
// ──────────────────────────────────────────────────────────────────────────

describe('parseOse — module loading (smoke)', () => {
  it('exporta as funções principais', () => {
    expect(typeof parseOse).toBe('function');
    expect(typeof parseMapaDxf).toBe('function');
    expect(typeof parsePerfisDxf).toBe('function');
    expect(typeof parseExcel).toBe('function');
    expect(typeof buildComparison).toBe('function');
  });

  it('exporta utilitários de detecção/erro de DXF', () => {
    expect(typeof parseOseModule.detectDxfFormat).toBe('function');
    expect(typeof parseOseModule.readDxfText).toBe('function');
    expect(typeof parseOseModule.scanDxfWarnings).toBe('function');
    expect(parseOseModule.DxfFormatError).toBeDefined();
    expect(parseOseModule.DxfTooLargeError).toBeDefined();
    expect(typeof parseOseModule.DXF_MAX_BYTES).toBe('number');
  });
});

describe.skip('parseMapaDxf — fixtures sintéticas (precisa fixture real)', () => {
  it('detecta uma OSE simples com 3 PVs', () => {
    const groups = wrapEntities([
      ...makeMtext({ layer: 'SES-TXT', text: 'OSE-005', x: 100, y: 100 }),
      ...makeMtext({ layer: 'SES-TXT', text: 'PV-001\\PCT:680.50\\PCF:678.20\\Ph:2.30', x: 100, y: 100 }),
      ...makeMtext({ layer: 'SES-TXT', text: 'PV-002\\PCT:680.10\\PCF:677.80\\Ph:2.30', x: 200, y: 100 }),
      ...makeMtext({ layer: 'SES-TXT', text: 'PV-003\\PCT:679.80\\PCF:677.50\\Ph:2.30', x: 300, y: 100 }),
    ]);
    const dxfPath = path.join(__dirname, 'fixtures', '_tmp_mapa_simples.dxf');
    fs.writeFileSync(dxfPath, makeDxfFromGroups(groups));

    const result = parseMapaDxf(dxfPath);
    expect(result.oses).toHaveProperty('005');
    fs.unlinkSync(dxfPath);
  });
});

describe('parseExcel — formato OSE-NNN', () => {
  it('detecta uma aba OSE-005 simples com 3 PVs', () => {
    const wb = buildOseWorkbook({
      'OSE-005': {
        comprimento: 152.96,
        rows: [
          { id: 'PV-001', este: 600100, norte: 7200100, cota: 680.50, ct: 680.50, cf: 678.20, dist: 0,    decl: 0.005, diam: 150, prof: 2.30 },
          { id: 'PV-002', este: 600200, norte: 7200100, cota: 680.10, ct: 680.10, cf: 677.80, dist: 50,   decl: 0.008, diam: 150, prof: 2.30 },
          { id: 'PV-003', este: 600300, norte: 7200100, cota: 679.80, ct: 679.80, cf: 677.50, dist: 100,  decl: 0.003, diam: 150, prof: 2.30 },
        ],
      },
    });
    const file = writeTempXlsx(wb, 'ose005_simples.xlsx');
    try {
      const result = parseExcel(file);
      expect(result).toHaveProperty('005');
      const ose = result['005'];
      expect(ose.comprimento).toBeCloseTo(152.96, 2);
      expect(Array.isArray(ose.pvs)).toBe(true);
      expect(ose.pvs.length).toBe(3);
      const ids = ose.pvs.map(p => p.id);
      expect(ids).toContain('PV-001');
      expect(ids).toContain('PV-002');
      expect(ids).toContain('PV-003');
    } finally {
      cleanupTempFile(file);
    }
  });

  it('OSE-005 e OSE-005A coexistem como chaves distintas (cobre v2.19.6)', () => {
    const wb = buildOseWorkbook({
      'OSE-005': {
        comprimento: 100,
        rows: [
          { id: 'PV-001', cota: 680, ct: 680, cf: 678, dist: 0,  diam: 150, prof: 2 },
          { id: 'PV-002', cota: 679, ct: 679, cf: 677, dist: 50, diam: 150, prof: 2 },
        ],
      },
      'OSE-005A': {
        comprimento: 50,
        rows: [
          { id: 'PV-001', cota: 681, ct: 681, cf: 679, dist: 0,  diam: 150, prof: 2 },
          { id: 'PV-002', cota: 680, ct: 680, cf: 678, dist: 25, diam: 150, prof: 2 },
        ],
      },
    });
    const file = writeTempXlsx(wb, 'ose005_e_005A.xlsx');
    try {
      const result = parseExcel(file);
      expect(result).toHaveProperty('005');
      expect(result).toHaveProperty('005A');
      expect(result['005']).not.toBe(result['005A']);
      expect(result['005'].comprimento).toBeCloseTo(100, 2);
      expect(result['005A'].comprimento).toBeCloseTo(50, 2);
    } finally {
      cleanupTempFile(file);
    }
  });

  it('rejeita linhas com cf sentinel < 50', () => {
    const wb = buildOseWorkbook({
      'OSE-007': {
        comprimento: 100,
        rows: [
          { id: 'PV-001', cota: 680, ct: 680, cf: 678,  dist: 0,  diam: 150, prof: 2 },  // OK
          { id: 'PV-002', cota: 680, ct: 680, cf: 42,   dist: 50, diam: 150, prof: 2 },  // sentinel
          { id: 'PV-003', cota: 679, ct: 679, cf: 677,  dist: 80, diam: 150, prof: 2 },  // OK
        ],
      },
    });
    const file = writeTempXlsx(wb, 'ose007_sentinel.xlsx');
    try {
      const result = parseExcel(file);
      const ose = result['007'];
      const ids = ose.pvs.map(p => p.id);
      expect(ids).toContain('PV-001');
      expect(ids).toContain('PV-003');
      expect(ids).not.toContain('PV-002');
    } finally {
      cleanupTempFile(file);
    }
  });
});

describe('parsePerfisDxf — declividade', () => {
  it.skip('extrai declividade de MTEXT multi-linha 0.0224\\n2.24% (cobre v2.10.13)', () => {
    // FIXTURE: DXF perfil com MTEXT contendo texto multi-linha
    // Esperado: declividade extraída corretamente, não confunde 0.0224 e 2.24
  });

  it.skip('detecta DXF binário e retorna erro claro (cobre v2.13.0)', () => {
    // FIXTURE: arquivo iniciando com bytes binários (AutoCAD Binary DXF)
    // Esperado: erro identificado como "DXF binário não suportado",
    //          não crash silencioso ou stack trace
  });

  it.skip('separa cota de chegada e saída do PV', () => {
    // FIXTURE: perfil com 1 PV mostrando cf_chegada e cf_saida diferentes
  });
});

describe('buildComparison — degrau', () => {
  it.skip('degrau correto usando InvertElevation (cobre v2.36.9)', () => {
    // O bug era que SafeInvStart usava Pipe.StartPoint.Z (centerline)
    // em vez de StartInvertElevation (autoritativo).
    // Em v2.36.9 fix foi no plugin Civil 3D (não no parseOse.js do Nexus),
    // mas a mesma lógica precisa estar correta no buildComparison
    // — degrau = cf_chegada_pv - cf_pv_proximo, não cota_topo - cota_topo.
  });

  it.skip('reconhece TL fora de cabeceira como erro', () => {
    // FIXTURE: OSE com TL no meio (não na cabeceira) → flag de erro
  });
});

describe('utilidades de normalização', () => {
  const { utils } = parseOseModule;

  it('normalizeId: tira espaços/hífens e zero-pad e maiúsculas', () => {
    expect(utils.normalizeId('PV-001')).toBe('PV1');
    expect(utils.normalizeId('pv 1')).toBe('PV1');
    expect(utils.normalizeId(' tl-007 ')).toBe('TL7');
  });

  it('normalizeId: preserva sufixo de letra em PV-NNNA (cobre Ubiratã)', () => {
    // O regex captura ([A-Z]+)0*(\d+)$ — sufixo de letra fica fora da captura,
    // logo é preservado. Confirma comportamento esperado pra OSE-590A etc.
    expect(utils.normalizeId('PV-590A')).toBe('PV-590A'.replace(/[\s\-]+/g, '').toUpperCase());
  });

  it('cleanMtext: remove \\f e \\C, preserva \\P como newline', () => {
    const raw = '\\fArial|c0;{\\C1;texto\\Pmais texto}';
    expect(utils.cleanMtext(raw)).toBe('texto\nmais texto');
  });

  it('cleanMtext: \\pxqc é removido', () => {
    expect(utils.cleanMtext('\\pxqc;abc')).toBe('abc');
  });

  it('pf: aceita vírgula decimal e devolve null pra entrada inválida', () => {
    expect(utils.pf('1,5')).toBe(1.5);
    expect(utils.pf('2.75')).toBe(2.75);
    expect(utils.pf('')).toBe(null);
    expect(utils.pf(null)).toBe(null);
    expect(utils.pf('xx')).toBe(null);
  });

  it('rnd: arredonda pra N casas', () => {
    expect(utils.rnd(1.23456, 2)).toBe(1.23);
    expect(utils.rnd(1.23556, 2)).toBe(1.24);
    expect(utils.rnd(null, 2)).toBe(null);
  });

  it('firstNum / lastNum: extrai primeiro/último número em string single-line', () => {
    expect(utils.firstNum('Dist: 0.0224')).toBe(0.0224);
    expect(utils.lastNum('Decl. final: 2.24%')).toBe(2.24);
  });

  it('cleanMtext + split + lastNum: cobre MTEXT multi-linha v2.10.13', () => {
    // Caso real: MTEXT com formatação + duas linhas representando a mesma
    // declividade ("0.0224" + "2.24%"). O parser deve usar a 1ª linha como
    // valor de declividade e não confundir com 24 (último \d+ na string).
    const raw = '\\C1;0.0224\\P2.24%';
    const cleaned = utils.cleanMtext(raw);
    expect(cleaned).toBe('0.0224\n2.24%');
    const lines = cleaned.split('\n');
    expect(utils.firstNum(lines[0])).toBe(0.0224);
    expect(utils.firstNum(lines[1])).toBe(2.24);
  });
});

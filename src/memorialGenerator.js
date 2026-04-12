/**
 * memorialGenerator.js — Gera Memorial Descritivo (.docx) programaticamente.
 *
 * Usa a lib 'docx' para montar o documento completo sem template externo.
 * Seções:
 *   1. Capa (título, código doc, revisão, data, responsáveis)
 *   2. Histórico de revisões
 *   3. Dados do projeto
 *   4. Resumo de extensões por DN e profundidade
 *   5. Resumo de unidades singulares
 *   6. Lista de trechos (se OSE data disponível)
 *
 * Cores e estilo seguem o padrão visual da 2S Engenharia.
 */
'use strict';

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle,
  PageBreak, ShadingType, VerticalAlign, Header, Footer,
  PageNumber, NumberFormat,
} = require('docx');

// ── Cores padrão ──────────────────────────────────────────────
const DARK    = '0F172A';
const SLATE   = '334155';
const LIGHT   = 'F1F5F9';
const GREEN   = '0F766E';
const WHITE   = 'FFFFFF';

// ── Helpers ───────────────────────────────────────────────────
function txt(text, opts = {}) {
  return new TextRun({ text, size: opts.size || 22, font: 'Calibri', ...opts });
}

function para(text, opts = {}) {
  const children = typeof text === 'string' ? [txt(text, opts)] : text;
  return new Paragraph({
    children,
    spacing: { after: opts.after != null ? opts.after : 120, before: opts.before || 0 },
    alignment: opts.alignment || AlignmentType.LEFT,
    heading: opts.heading,
    indent: opts.indent,
  });
}

function headerPara(text, level) {
  return new Paragraph({
    text,
    heading: level || HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 160 },
    children: [txt(text, { bold: true, size: level === HeadingLevel.HEADING_2 ? 26 : 30, color: DARK })],
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    children: [para(text, { size: opts.size || 20, bold: opts.bold, alignment: opts.alignment, after: 40 })],
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.bg ? { fill: opts.bg, type: ShadingType.SOLID } : undefined,
    verticalAlign: VerticalAlign.CENTER,
  });
}

function hdrCell(text, width) {
  return cell(text, { bold: true, bg: DARK, size: 18, width, alignment: AlignmentType.CENTER });
}

function dataCell(text, width, opts = {}) {
  return cell(text || '—', { size: 20, width, ...opts });
}

function keyVal(key, value) {
  return new Paragraph({
    children: [
      txt(key + ':  ', { bold: true, size: 22, color: SLATE }),
      txt(value || '—', { size: 22 }),
    ],
    spacing: { after: 80 },
  });
}

// ── Gerador principal ─────────────────────────────────────────
/**
 * @param {Object} info - Dados do projeto/orçamento + extras do modal
 *   info.titulo, info.codigo_documento, info.cidade, info.uf,
 *   info.sistema, info.microbacia, info.revisao, info.data_orcamento,
 *   info.elaborador, info.eng_responsavel, info.eng_crea,
 *   info.art, info.contrato, info.ete_destino, info.empresa
 *
 * @param {Object} oseAgg - Agregados da conferência OSE (pode ser null)
 *   oseAgg.oses_total, oseAgg.L_total, oseAgg.pvs_count, oseAgg.tls_count,
 *   oseAgg.pvs_por_faixa: {'0-2':N, '2-3':N, '3-4':N, '4+':N},
 *   oseAgg.tqs_count, oseAgg.trechos: [{trecho, pvMont, pvJus, profMont, profJus, ext, diam, decl}]
 */
async function generateMemorial(info, oseAgg) {
  const sections = [];

  // ════════════════════════════════════════════════════════════
  // SEÇÃO 1: CAPA
  // ════════════════════════════════════════════════════════════
  const capa = [];
  capa.push(para('', { after: 600 }));
  capa.push(para('', { after: 600 }));
  capa.push(para(info.empresa || '2S ENGENHARIA E GEOTECNOLOGIA', {
    alignment: AlignmentType.CENTER,
    size: 20, color: SLATE,
  }));
  capa.push(para('', { after: 200 }));
  capa.push(para('MEMORIAL DESCRITIVO E DE CÁLCULO', {
    alignment: AlignmentType.CENTER,
    bold: true, size: 36, color: DARK,
  }));
  capa.push(para('DE REDE COLETORA DE ESGOTO', {
    alignment: AlignmentType.CENTER,
    bold: true, size: 28, color: SLATE,
  }));
  capa.push(para('', { after: 300 }));
  capa.push(para(info.titulo || 'Projeto Executivo', {
    alignment: AlignmentType.CENTER,
    bold: true, size: 24, color: GREEN,
  }));
  capa.push(para('', { after: 400 }));

  // Info box na capa
  const capaInfo = [
    ['Contrato:', info.contrato || '—'],
    ['Cidade:', [info.cidade, info.uf].filter(Boolean).join(' / ') || '—'],
    ['Sistema:', info.sistema || '—'],
    ['Microbacia:', info.microbacia || '—'],
    ['Revisão:', info.revisao || '—'],
    ['Data:', info.data_orcamento || '—'],
    ['ART:', info.art || '—'],
    ['Elaboração:', info.elaborador || '—'],
    ['Eng. Responsável:', [info.eng_responsavel, info.eng_crea].filter(Boolean).join(' — ') || '—'],
  ];
  const capaTable = new Table({
    rows: capaInfo.map(([k, v]) => new TableRow({
      children: [
        cell(k, { bold: true, width: 30, bg: LIGHT, alignment: AlignmentType.RIGHT }),
        cell(v, { width: 70 }),
      ],
    })),
    width: { size: 80, type: WidthType.PERCENTAGE },
  });
  capa.push(capaTable);
  capa.push(para('', { after: 400 }));
  capa.push(para('Documento gerado por Nexus — 2S Engenharia', {
    alignment: AlignmentType.CENTER,
    size: 16, color: SLATE, italic: true,
  }));

  sections.push({
    properties: { page: { margin: { top: 1440, right: 1080, bottom: 1440, left: 1440 } } },
    children: capa,
  });

  // ════════════════════════════════════════════════════════════
  // SEÇÃO 2: CORPO DO MEMORIAL
  // ════════════════════════════════════════════════════════════
  const body = [];

  // 2.1 Histórico de revisões
  body.push(headerPara('HISTÓRICO DE REVISÕES'));
  body.push(new Table({
    rows: [
      new TableRow({ children: [hdrCell('Nº'), hdrCell('Revisão'), hdrCell('Data'), hdrCell('Elaboração'), hdrCell('Aprovação')] }),
      new TableRow({ children: [
        dataCell(info.revisao || '00'), dataCell('Emissão ' + (info.revisao === 'R00' ? 'Inicial' : 'de informações')),
        dataCell(info.data_orcamento || '—'), dataCell(info.elaborador || '—'), dataCell(info.eng_responsavel || '—'),
      ]}),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));
  body.push(para(''));

  // 2.2 Dados do projeto
  body.push(headerPara('DADOS DO PROJETO'));
  body.push(keyVal('Projeto', info.titulo));
  body.push(keyVal('Código do documento', info.codigo_documento));
  body.push(keyVal('Localização', [info.cidade, info.uf].filter(Boolean).join(' — ')));
  body.push(keyVal('Sistema', info.sistema));
  body.push(keyVal('Microbacia / Área', info.microbacia));
  body.push(keyVal('ART', info.art));
  body.push(keyVal('Elaboração', info.elaborador));
  body.push(keyVal('Eng. Responsável', [info.eng_responsavel, info.eng_crea].filter(Boolean).join(' — ')));
  if (info.ete_destino) body.push(keyVal('ETE de destino', info.ete_destino));
  body.push(para(''));

  // 2.3 Apresentação (placeholder)
  body.push(headerPara('APRESENTAÇÃO'));
  body.push(para(
    'O presente documento formaliza a apresentação do PROJETO EXECUTIVO DE REDE DE ESGOTAMENTO SANITÁRIO '
    + 'para o município de ' + (info.cidade || '______') + ' / ' + (info.uf || '__') + '. '
    + 'Este volume técnico foi elaborado em cumprimento às cláusulas contratuais estabelecidas, '
    + 'representando as metas de expansão e melhoria da infraestrutura de saneamento básico.'
  ));
  body.push(para(
    'O Projeto Executivo insere-se no conjunto de estudos e projetos que visam à ampliação e '
    + 'modernização da rede de esgotamento sanitário, com foco na sub-bacia ' + (info.microbacia || '______')
    + ', que integra o sistema ' + (info.sistema || '______') + '.'
  ));
  body.push(para('[Complementar esta seção com informações específicas do projeto, '
    + 'figuras de localização, traçado de redes e divisão de sub-bacias.]', { italic: true, color: SLATE }));
  body.push(para(''));

  // 2.4 Critérios de dimensionamento (boilerplate)
  body.push(headerPara('CRITÉRIOS DE DIMENSIONAMENTO'));
  body.push(para('O dimensionamento hidráulico-sanitário da rede coletora segue os critérios da NBR 9649/1986 '
    + 'e diretrizes específicas da concessionária. Os principais parâmetros adotados são:'));
  const criterios = [
    'Diâmetro mínimo da rede coletora: DN 150 mm',
    'Profundidade mínima de recobrimento: 1,10 m (PV e TL)',
    'Declividade mínima: 1,00% para profundidades ≤ 3 m; 0,55% para profundidades > 3 m',
    'Material das tubulações: PVC Vinilfort ou equivalente, junta elástica',
    'Poços de Visita: pré-moldados em concreto Ø800 mm, Ø1000 mm ou Ø1500 mm conforme profundidade',
    'Terminal de Limpeza (TL): para início de rede com profundidade ≤ 1,30 m',
    'Tubo de queda: quando o desnível entre GI de chegada e CF do PV ultrapassar critérios de degrau',
  ];
  criterios.forEach(c => body.push(para('  •  ' + c, { size: 20 })));
  body.push(para(''));

  // ════════════════════════════════════════════════════════════
  // SEÇÃO 3: TABELAS (dados do parser OSE)
  // ════════════════════════════════════════════════════════════
  if (oseAgg) {
    // 3.1 Resumo geral
    body.push(headerPara('RESUMO DO PROJETO'));
    body.push(keyVal('Total de OSEs (trechos)', String(oseAgg.oses_total || 0)));
    body.push(keyVal('Extensão total da rede (Mapa)', (oseAgg.L_total || 0).toFixed(2) + ' m'));
    body.push(keyVal('Poços de Visita (PV)', String(oseAgg.pvs_count || 0)));
    body.push(keyVal('Terminais de Limpeza (TL)', String(oseAgg.tls_count || 0)));
    body.push(keyVal('Tubos de queda / degraus', String(oseAgg.tqs_count || 0)));
    if (info.ete_destino) body.push(keyVal('Destino do efluente', info.ete_destino));
    body.push(para(''));

    // 3.2 Tabela: Resumo de Extensões por Profundidade
    body.push(headerPara('RESUMO DE EXTENSÕES POR PROFUNDIDADE', HeadingLevel.HEADING_2));
    body.push(para('A tabela abaixo apresenta o resumo das extensões de rede coletora projetada, '
      + 'agrupadas por faixa de profundidade média do trecho.'));
    body.push(para('[Nota: as profundidades são extraídas da planilha de cálculo hidráulico. '
      + 'Para resumo completo por DN, consulte a planilha de memorial de cálculo.]', { italic: true, color: SLATE, size: 18 }));
    body.push(para(''));

    // 3.3 Tabela: Unidades Singulares por Tipo
    body.push(headerPara('RESUMO DE UNIDADES SINGULARES', HeadingLevel.HEADING_2));

    const pvFaixas = oseAgg.pvs_por_faixa || {};
    const singRows = [
      new TableRow({ children: [hdrCell('Tipo', 50), hdrCell('Quantidade', 25), hdrCell('Faixa de profundidade', 25)] }),
    ];
    if (pvFaixas['0-2'] > 0) singRows.push(new TableRow({ children: [
      dataCell('Poço de Visita (PV)'), dataCell(String(pvFaixas['0-2']), 25, { alignment: AlignmentType.CENTER }),
      dataCell('0 a 2 m'),
    ]}));
    if (pvFaixas['2-3'] > 0) singRows.push(new TableRow({ children: [
      dataCell('Poço de Visita (PV)'), dataCell(String(pvFaixas['2-3']), 25, { alignment: AlignmentType.CENTER }),
      dataCell('2 a 3 m'),
    ]}));
    if (pvFaixas['3-4'] > 0) singRows.push(new TableRow({ children: [
      dataCell('Poço de Visita (PV)'), dataCell(String(pvFaixas['3-4']), 25, { alignment: AlignmentType.CENTER }),
      dataCell('3 a 4 m'),
    ]}));
    if (pvFaixas['4+'] > 0) singRows.push(new TableRow({ children: [
      dataCell('Poço de Visita (PV)'), dataCell(String(pvFaixas['4+']), 25, { alignment: AlignmentType.CENTER }),
      dataCell('> 4 m'),
    ]}));
    if ((oseAgg.tls_count || 0) > 0) singRows.push(new TableRow({ children: [
      dataCell('Terminal de Limpeza (TL)'), dataCell(String(oseAgg.tls_count), 25, { alignment: AlignmentType.CENTER }),
      dataCell('Profundidade ≤ 1,30 m'),
    ]}));
    if ((oseAgg.tqs_count || 0) > 0) singRows.push(new TableRow({ children: [
      dataCell('Tubo de queda / degrau'), dataCell(String(oseAgg.tqs_count), 25, { alignment: AlignmentType.CENTER }),
      dataCell('—'),
    ]}));
    // Total
    const totalSing = (pvFaixas['0-2']||0) + (pvFaixas['2-3']||0) + (pvFaixas['3-4']||0) + (pvFaixas['4+']||0) + (oseAgg.tls_count||0);
    singRows.push(new TableRow({ children: [
      cell('TOTAL', { bold: true, bg: LIGHT }), cell(String(totalSing), { bold: true, bg: LIGHT, alignment: AlignmentType.CENTER }),
      cell('', { bg: LIGHT }),
    ]}));

    body.push(new Table({
      rows: singRows,
      width: { size: 100, type: WidthType.PERCENTAGE },
    }));
    body.push(para(''));

    // 3.4 Lista de trechos (se disponível)
    if (oseAgg.trechos && oseAgg.trechos.length) {
      body.push(headerPara('TABELA POR TRECHO COM PROFUNDIDADES E EXTENSÕES', HeadingLevel.HEADING_2));
      const tRows = [
        new TableRow({ children: [
          hdrCell('Trecho'), hdrCell('PV Montante'), hdrCell('PV Jusante'),
          hdrCell('Prof. Mont. (m)'), hdrCell('Prof. Jus. (m)'),
          hdrCell('Extensão (m)'), hdrCell('DN (mm)'), hdrCell('Decl. (m/m)'),
        ]}),
      ];
      oseAgg.trechos.forEach(t => {
        tRows.push(new TableRow({ children: [
          dataCell(t.trecho), dataCell(t.pvMont), dataCell(t.pvJus),
          dataCell(t.profMont != null ? t.profMont.toFixed(3) : '—', null, { alignment: AlignmentType.RIGHT }),
          dataCell(t.profJus != null ? t.profJus.toFixed(3) : '—', null, { alignment: AlignmentType.RIGHT }),
          dataCell(t.ext != null ? t.ext.toFixed(2) : '—', null, { alignment: AlignmentType.RIGHT }),
          dataCell(t.diam != null ? String(t.diam) : '—', null, { alignment: AlignmentType.CENTER }),
          dataCell(t.decl != null ? t.decl.toFixed(6) : '—', null, { alignment: AlignmentType.RIGHT }),
        ]}));
      });
      body.push(new Table({
        rows: tRows,
        width: { size: 100, type: WidthType.PERCENTAGE },
      }));
      body.push(para(''));
    }
  } else {
    body.push(headerPara('RESUMO DO PROJETO'));
    body.push(para('[Nenhum dado de conferência OSE disponível. Execute a conferência na aba correspondente '
      + 'do Nexus e gere o memorial novamente para incluir as tabelas de resumo automaticamente.]',
      { italic: true, color: SLATE }));
    body.push(para(''));
  }

  // 2.5 Caracterização construtiva (boilerplate)
  body.push(headerPara('CARACTERIZAÇÃO DOS ELEMENTOS CONSTRUTIVOS'));
  body.push(headerPara('Tubulações', HeadingLevel.HEADING_2));
  body.push(para('As tubulações da rede coletora de esgoto são em PVC Vinilfort, junta elástica, '
    + 'conforme norma NBR 7362. Os diâmetros utilizados variam de DN 150 mm a DN 400 mm, '
    + 'de acordo com o dimensionamento hidráulico de cada trecho.'));
  body.push(headerPara('Poços de Visita', HeadingLevel.HEADING_2));
  body.push(para('Os Poços de Visita são pré-moldados em concreto, com diâmetro mínimo de 800 mm. '
    + 'Para profundidades superiores a 3 m, utiliza-se Ø1000 mm ou Ø1500 mm conforme especificação.'));
  body.push(headerPara('Terminais de Limpeza', HeadingLevel.HEADING_2));
  body.push(para('Os TLs são utilizados como dispositivo de início de rede, em cabeceiras onde a '
    + 'profundidade não excede 1,30 m. Acima deste valor, o TL deve ser substituído por PV.'));
  body.push(headerPara('Ligações Prediais', HeadingLevel.HEADING_2));
  body.push(para('As ligações prediais são executadas em PVC DN 100 mm, com sela e braçadeira, '
    + 'conectadas à rede coletora principal por meio de caixas de inspeção.'));
  body.push(para(''));

  // Rodapé
  body.push(para(''));
  body.push(para('— FIM DO MEMORIAL DESCRITIVO —', {
    alignment: AlignmentType.CENTER, bold: true, size: 20, color: SLATE,
  }));

  sections.push({
    properties: {
      page: {
        margin: { top: 1440, right: 1080, bottom: 1440, left: 1440 },
        pageNumbers: { start: 1 },
      },
    },
    headers: {
      default: new Header({
        children: [para([
          txt(info.empresa || '2S ENGENHARIA E GEOTECNOLOGIA', { size: 16, color: SLATE, italic: true }),
          txt('    |    ', { size: 16, color: 'CBD5E1' }),
          txt(info.codigo_documento || info.titulo || 'Memorial Descritivo', { size: 16, color: SLATE, italic: true }),
        ], { alignment: AlignmentType.RIGHT, after: 60 })],
      }),
    },
    footers: {
      default: new Footer({
        children: [para([
          txt('Página ', { size: 16, color: SLATE }),
        ], { alignment: AlignmentType.CENTER, after: 0 })],
      }),
    },
    children: body,
  });

  // ── Gera o buffer ──
  const doc = new Document({
    creator: info.elaborador || 'Nexus — 2S Engenharia',
    title: info.titulo || 'Memorial Descritivo',
    description: 'Memorial Descritivo gerado automaticamente pelo Nexus',
    sections,
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateMemorial };

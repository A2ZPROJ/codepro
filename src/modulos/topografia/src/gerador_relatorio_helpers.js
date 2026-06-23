/**
 * Gerador de relatório de topografia — Padrão 2S Engenharia
 * 
 * Reproduz fielmente o layout do modelo RT-002-SDE-GER-PE-TOPO da 2S:
 *   - Cabeçalho timbrado da 2S em todas as páginas
 *   - Rodapé com contato + paginação
 *   - 16 seções na ordem do modelo
 *   - Análise altimétrica seguindo a metodologia da 2S
 * 
 * Dependências: npm install docx
 * Assets necessários: cabecalho_2s.png e rodape_2s.png na pasta assets/
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, LevelFormat, Header, Footer, PageNumber, NumberFormat,
} = require('docx');

// ============================================================
// CONSTANTES DE ESTILO
// ============================================================

const COR_TEXTO = '262626';        // preto suave
const COR_TITULO_2S = '1F6F8B';    // azul-petróleo dos títulos (visto no Sumário)
const COR_TITULO_PRETO = '000000'; // preto puro
const COR_BORDA = 'C0C0C0';
const COR_HEADER_TABELA = 'F2F2F2';

const border = { style: BorderStyle.SINGLE, size: 4, color: COR_BORDA };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargin = { top: 100, bottom: 100, left: 140, right: 140 };

// ============================================================
// HELPERS DE FORMATAÇÃO
// ============================================================

const fmtNum = (n, dec = 3) => Number(n).toLocaleString('pt-BR', {
  minimumFractionDigits: dec, maximumFractionDigits: dec,
});
const fmtInt = (n) => Number(n).toLocaleString('pt-BR');

function celula(texto, opts = {}) {
  return new TableCell({
    borders,
    width: { size: opts.width || 4680, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR } : undefined,
    margins: cellMargin,
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text: texto, bold: opts.bold || false, size: opts.size || 20,
        color: opts.color || COR_TEXTO, font: 'Arial',
      })],
    })],
  });
}

function paragrafo(texto, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before || 0, after: opts.after || 120, line: 320 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    indent: opts.indent ? { left: 720 } : undefined,
    children: [new TextRun({
      text: texto,
      bold: opts.bold || false,
      italics: opts.italics || false,
      size: opts.size || 22,
      color: opts.color || COR_TEXTO,
      font: 'Arial',
    })],
  });
}

function bullet(texto, level = 0) {
  return new Paragraph({
    numbering: { reference: level === 0 ? 'bullets' : 'bullets-sub', level: 0 },
    spacing: { after: 80, line: 300 },
    alignment: AlignmentType.JUSTIFIED,
    children: [new TextRun({ text: texto, size: 22, color: COR_TEXTO, font: 'Arial' })],
  });
}

function bulletNegrito(textoBold, textoNormal = '', level = 0) {
  return new Paragraph({
    numbering: { reference: level === 0 ? 'bullets' : 'bullets-sub', level: 0 },
    spacing: { after: 80, line: 300 },
    alignment: AlignmentType.JUSTIFIED,
    children: [
      new TextRun({ text: textoBold, bold: true, size: 22, color: COR_TEXTO, font: 'Arial' }),
      new TextRun({ text: textoNormal, size: 22, color: COR_TEXTO, font: 'Arial' }),
    ],
  });
}

function titulo1(texto) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({
      text: texto, bold: true, size: 28, color: COR_TITULO_PRETO, font: 'Arial',
    })],
  });
}

function subtitulo(texto) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({
      text: texto, bold: true, size: 22, color: COR_TEXTO, font: 'Arial',
    })],
  });
}

function paragrafoVazio(altura = 120) {
  return new Paragraph({
    spacing: { after: altura },
    children: [new TextRun({ text: '' })],
  });
}

// ============================================================
// HEADER E FOOTER (TIMBRE 2S)
// ============================================================

function criarHeader(cabecalhoPng) {
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 0 },
        children: [new ImageRun({
          data: fs.readFileSync(cabecalhoPng),
          transformation: { width: 595, height: 108 },
          type: 'png',
        })],
      }),
    ],
  });
}

function criarFooter(rodapePng) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: [new ImageRun({
          data: fs.readFileSync(rodapePng),
          transformation: { width: 480, height: 46 },
          type: 'png',
        })],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 18, color: COR_TEXTO, font: 'Arial',
          }),
          new TextRun({ text: ' / ', size: 18, color: COR_TEXTO, font: 'Arial' }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: 18, color: COR_TEXTO, font: 'Arial',
          }),
        ],
      }),
    ],
  });
}

// Exporta helpers para o segundo arquivo
module.exports = {
  COR_TEXTO, COR_TITULO_2S, COR_TITULO_PRETO, COR_BORDA, COR_HEADER_TABELA,
  border, borders, cellMargin,
  fmtNum, fmtInt,
  celula, paragrafo, bullet, bulletNegrito, titulo1, subtitulo, paragrafoVazio,
  criarHeader, criarFooter,
};

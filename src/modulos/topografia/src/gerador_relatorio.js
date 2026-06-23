/**
 * Gerador de relatório 2S — versão TEMPLATE V3
 * 
 * Mudanças em relação à V2:
 *   - Todos os valores dinâmicos inseridos com HIGHLIGHT AMARELO (validação visual)
 *   - Fotos da equipe: 1 linha por dia, 2 colunas (Equipe X + Equipe Y do mesmo dia)
 *   - Seção 14 (Área de abrangência): aceita PNG opcional
 *   - Seção 16 (ART): aceita múltiplas imagens (1 por página) + sub-título "Corresponsável"
 *   - Seção 12.1 (Análise por proximidade): valores reais calculados
 * 
 * Template: assets/template_2s.docx (baseado no Floresta limpo)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

const TEMPLATE_PADRAO = path.join(__dirname, '..', 'assets', 'template_2s.docx');

// ============================================================
// FORMATAÇÃO
// ============================================================

const fmtInt = (n) => Number(n).toLocaleString('pt-BR');
const fmt3v = (n) => Number(n).toFixed(3).replace('.', ',');   // 309,115
const fmt2v = (n) => Number(n).toFixed(2).replace('.', ',');   // 1,27
const fmt1v = (n) => Number(n).toFixed(1).replace('.', ',');   // 72,2

const cmToEmu = (cm) => Math.round(cm * 360000);

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================
// SUBSTITUIÇÃO COM HIGHLIGHT AMARELO
// ============================================================

/**
 * Substitui {{KEY}} por <novo run com w:highlight=yellow>VALOR</run>,
 * preservando o run original ao redor.
 */
function substituirComHighlight(xml, placeholder, valor) {
  const valorEscapado = escapeXml(valor);
  let result = '';
  let offset = 0;
  
  while (true) {
    const idx = xml.indexOf(placeholder, offset);
    if (idx < 0) {
      result += xml.slice(offset);
      break;
    }
    
    // Achar o <w:r> que contém esse placeholder
    const idxR1 = xml.lastIndexOf('<w:r>', idx);
    const idxR2 = xml.lastIndexOf('<w:r ', idx);
    const idxRunStart = Math.max(idxR1, idxR2);
    if (idxRunStart < 0 || idxRunStart < offset) {
      result += xml.slice(offset, idx) + valorEscapado;
      offset = idx + placeholder.length;
      continue;
    }
    
    const idxRunEnd = xml.indexOf('</w:r>', idx);
    if (idxRunEnd < 0) {
      result += xml.slice(offset, idx) + valorEscapado;
      offset = idx + placeholder.length;
      continue;
    }
    const runEnd = idxRunEnd + '</w:r>'.length;
    const runXml = xml.slice(idxRunStart, runEnd);
    
    let rPr = '';
    const matchRPr = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    if (matchRPr) rPr = matchRPr[1];
    
    const matchT = runXml.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/);
    if (!matchT) {
      result += xml.slice(offset, idx) + valorEscapado;
      offset = idx + placeholder.length;
      continue;
    }
    const textoCompleto = matchT[1];
    if (!textoCompleto.includes(placeholder)) {
      result += xml.slice(offset, idx) + valorEscapado;
      offset = idx + placeholder.length;
      continue;
    }
    
    const partes = textoCompleto.split(placeholder);
    const antes = partes[0];
    const depois = partes.slice(1).join(placeholder);
    
    const rPrXml = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
    const rPrComHL = rPr 
      ? `<w:rPr>${rPr}<w:highlight w:val="yellow"/></w:rPr>`
      : `<w:rPr><w:highlight w:val="yellow"/></w:rPr>`;
    
    let novoRun = '';
    if (antes) novoRun += `<w:r>${rPrXml}<w:t xml:space="preserve">${antes}</w:t></w:r>`;
    novoRun += `<w:r>${rPrComHL}<w:t xml:space="preserve">${valorEscapado}</w:t></w:r>`;
    if (depois) novoRun += `<w:r>${rPrXml}<w:t xml:space="preserve">${depois}</w:t></w:r>`;
    
    result += xml.slice(offset, idxRunStart) + novoRun;
    offset = runEnd;
  }
  
  return result;
}

// ============================================================
// INTERPRETAÇÃO TEXTUAL
// ============================================================

function interpretaAmplitude(ampM) {
  if (ampM < 20) return 'relevo praticamente plano';
  if (ampM < 50) return 'relevo suavemente ondulado';
  if (ampM < 100) return 'relevo ondulado';
  return 'relevo movimentado';
}

function textoInterpretacaoRugosidade(rug, raio = 30) {
  if (rug < 0.8) {
    return `O terreno apresenta variação altimétrica LOCAL baixa (rugosidade média ${fmt2v(Math.max(0, rug - 0.3))} a ${fmt2v(rug + 0.2)} m em raio de ${raio} m), indicando superfície suave com declives contínuos e regulares. Propício para projetos de drenagem por gravidade.`;
  }
  if (rug < 2.0) {
    return `O terreno apresenta variação altimétrica LOCAL moderada (rugosidade média ${fmt2v(Math.max(0, rug - 0.3))} a ${fmt2v(rug + 0.2)} m em raio de ${raio} m), indicando variações que demandam atenção no traçado e dimensionamento das redes.`;
  }
  return `O terreno apresenta variação altimétrica LOCAL alta (rugosidade média ${fmt2v(Math.max(0, rug - 0.3))} a ${fmt2v(rug + 0.2)} m em raio de ${raio} m), indicando relevo movimentado.`;
}

function textoInterpretacaoPlanicies(pct) {
  const grau = pct >= 80 ? 'clara' : (pct >= 60 ? 'moderada' : 'parcial');
  const desc = pct >= 70 ? 'poucas' : 'algumas';
  return `Predominância ${grau} de planícies/superfícies regulares (${fmt1v(pct)}% dos pontos), caracterizando terreno com ${desc} descontinuidades morfológicas.`;
}

function textoInterpretacaoSimetria(altas, baixas, p95Anom) {
  const dif = Math.abs(altas - baixas);
  const balanco = dif < 3 ? 'Boa simetria' : 'Assimetria moderada';
  const eq = dif < 3 ? 'em equilíbrio entre divisores e vales de drenagem'
                      : 'com tendência morfológica definida';
  const disp = p95Anom < 1
    ? 'A dispersão é controlada (P95 < 1 m), sem evidência de outliers relevantes.'
    : `Recomenda-se revisão visual de pontos com anomalia superior a ${fmt2v(p95Anom)} m antes do processamento final do MDT.`;
  return `${balanco} entre feições elevadas e deprimidas (${fmt1v(altas)}% vs ${fmt1v(baixas)}%), consistente com área ${eq}. ${disp}`;
}

// ============================================================
// CONSTRUÇÃO DE XML
// ============================================================

function paragrafoComImagem(relId, cxEmu, cyEmu, align = 'center') {
  const id = Math.floor(Math.random() * 1e9);
  return `
    <w:p>
      <w:pPr><w:jc w:val="${align}"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:noProof/></w:rPr>
        <w:drawing>
          <wp:inline distT="0" distB="0" distL="0" distR="0">
            <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
            <wp:effectExtent l="0" t="0" r="0" b="0"/>
            <wp:docPr id="${id}" name="Imagem ${id}"/>
            <wp:cNvGraphicFramePr>
              <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
            </wp:cNvGraphicFramePr>
            <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                  <pic:nvPicPr><pic:cNvPr id="${id}" name="Imagem ${id}"/><pic:cNvPicPr/></pic:nvPicPr>
                  <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                  <pic:spPr>
                    <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>
                    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                  </pic:spPr>
                </pic:pic>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>`;
}

function paragrafoTexto(texto, opts = {}) {
  const { bold = false, italic = false, size = 22, color = '000000', align = 'left', highlight = false } = opts;
  return `
    <w:p>
      <w:pPr><w:jc w:val="${align}"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr></w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>
          ${bold ? '<w:b/><w:bCs/>' : ''}
          ${italic ? '<w:i/><w:iCs/>' : ''}
          <w:sz w:val="${size}"/>
          <w:color w:val="${color}"/>
          ${highlight ? '<w:highlight w:val="yellow"/>' : ''}
        </w:rPr>
        <w:t xml:space="preserve">${escapeXml(texto)}</w:t>
      </w:r>
    </w:p>`;
}

function subtituloART(texto) {
  return `
    <w:p>
      <w:pPr><w:spacing w:before="240" w:after="120"/><w:jc w:val="center"/>
      <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="24"/></w:rPr></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="24"/></w:rPr>
        <w:t xml:space="preserve">${escapeXml(texto)}</w:t>
      </w:r>
    </w:p>`;
}

/**
 * Tabela de fotos agrupada POR DIA: 1 linha = 1 dia, 2 colunas = 2 equipes.
 * @param {Array<{caminho, data, equipe?}>} fotos
 */
function tabelaFotosPorDia(fotos, municipio, relIdMap) {
  if (!fotos || fotos.length === 0) return '';
  
  // Agrupar por data
  const porData = {};
  for (const f of fotos) {
    if (!relIdMap[f.caminho]) continue;
    if (!porData[f.data]) porData[f.data] = [];
    porData[f.data].push(f);
  }
  
  const datas = Object.keys(porData).sort((a, b) => {
    const [da, ma, ya] = a.split('/').map(Number);
    const [db, mb, yb] = b.split('/').map(Number);
    return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
  });
  
  const CELL_W = 4250;
  const FOTO_CX = cmToEmu(6.5);
  const FOTO_CY = cmToEmu(7);
  
  let rows = '';
  for (const data of datas) {
    const fotosDoDia = porData[data].sort((a, b) => (a.equipe || '').localeCompare(b.equipe || ''));
    const legenda = `${municipio} – ${data}`;
    
    const cel = (foto) => {
      if (!foto) {
        return `<w:tc><w:tcPr><w:tcW w:w="${CELL_W}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p></w:tc>`;
      }
      const relId = relIdMap[foto.caminho];
      const idImg = Math.floor(Math.random() * 1e9);
      return `<w:tc>
        <w:tcPr>
          <w:tcW w:w="${CELL_W}" w:type="dxa"/>
          <w:tcBorders>
            <w:top w:val="single" w:sz="4" w:color="000000"/>
            <w:left w:val="single" w:sz="4" w:color="000000"/>
            <w:bottom w:val="single" w:sz="4" w:color="000000"/>
            <w:right w:val="single" w:sz="4" w:color="000000"/>
          </w:tcBorders>
        </w:tcPr>
        <w:p>
          <w:pPr><w:spacing w:before="120" w:after="60"/><w:jc w:val="center"/></w:pPr>
          <w:r>
            <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:noProof/></w:rPr>
            <w:drawing>
              <wp:inline distT="0" distB="0" distL="0" distR="0">
                <wp:extent cx="${FOTO_CX}" cy="${FOTO_CY}"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:docPr id="${idImg}" name="Foto ${idImg}"/>
                <wp:cNvGraphicFramePr>
                  <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
                </wp:cNvGraphicFramePr>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                    <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                      <pic:nvPicPr><pic:cNvPr id="${idImg}" name="Foto ${idImg}"/><pic:cNvPicPr/></pic:nvPicPr>
                      <pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
                      <pic:spPr>
                        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${FOTO_CX}" cy="${FOTO_CY}"/></a:xfrm>
                        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                      </pic:spPr>
                    </pic:pic>
                  </a:graphicData>
                </a:graphic>
              </wp:inline>
            </w:drawing>
          </w:r>
        </w:p>
        <w:p>
          <w:pPr><w:spacing w:after="120"/><w:jc w:val="center"/></w:pPr>
          <w:r>
            <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:sz w:val="20"/><w:highlight w:val="yellow"/></w:rPr>
            <w:t>${escapeXml(legenda)}</w:t>
          </w:r>
        </w:p>
      </w:tc>`;
    };
    
    // Renderiza TODAS as fotos do dia em grupos de 2 por linha
    for (let k = 0; k < fotosDoDia.length; k += 2) {
      const f1 = fotosDoDia[k];
      const f2 = fotosDoDia[k + 1];
      rows += `<w:tr>
        ${cel(f1)}${cel(f2)}
      </w:tr>`;
    }
  }
  
  return `
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:jc w:val="center"/>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="${CELL_W}"/>
        <w:gridCol w:w="${CELL_W}"/>
      </w:tblGrid>
      ${rows}
    </w:tbl>`;
}

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================

function obterProximoRelId(relsXml) {
  const matches = relsXml.match(/Id="rId(\d+)"/g) || [];
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m.match(/(\d+)/)[1], 10);
    if (n > max) max = n;
  }
  return max + 1;
}

async function gerarRelatorio2S(stats, caminhoSaida, opts = {}) {
  const {
    templatePath = TEMPLATE_PADRAO,
    histogramaPng = null,
    mapaCotasPng = null,
    mapa3dPng = null,
    mapaAbrangenciaPng = null,
    fotosEquipe = [],
    artImagens = [],
    extensaoKm = null,
  } = opts;

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template não encontrado: ${templatePath}`);
  }

  const zip = new AdmZip(templatePath);
  let documentXml = zip.readAsText('word/document.xml');
  let relsXml = zip.readAsText('word/_rels/document.xml.rels');
  let contentTypesXml = zip.readAsText('[Content_Types].xml');

  // === Valores calculados ===
  const alt = stats.altimetria;
  const gnss = stats.gnss;
  const prox = stats.proximidade;
  const ext = stats.extensao_levantamento;
  
  const extensaoMostrar = extensaoKm != null
    ? extensaoKm
    : +Math.hypot(ext.ns_km, ext.ew_km).toFixed(2);
  
  const datas = stats.datas_levantamento;
  const dataIni = datas[0];
  const dataFim = datas[datas.length - 1];

  const altas = (prox.morfologia.Cumes.pct || 0) + (prox.morfologia.Cristas.pct || 0);
  const baixas = (prox.morfologia.Talvegues.pct || 0) + (prox.morfologia.Vales.pct || 0);
  
  const placeholders = {
    'MUNICIPIO': stats.municipio,
    'UF': stats.uf,
    'UF_NOME': stats.uf === 'PR' ? 'Paraná' : stats.uf,
    'N_EQUIPES': String(stats.equipes.length),
    'DATA_INI': dataIni,
    'DATA_FIM': dataFim,
    'EXTENSAO_KM': fmt2v(extensaoMostrar),
    'N_PONTOS': fmtInt(stats.total_pontos),
    // GNSS
    'HRMS_MIN': fmt3v(gnss.hrms.faixa_min),
    'HRMS_MAX': fmt3v(gnss.hrms.faixa_max),
    'HRMS_TIP': fmt3v(gnss.hrms.mediana),
    'VRMS_MIN': fmt3v(gnss.vrms.faixa_min),
    'VRMS_MAX': fmt3v(gnss.vrms.faixa_max),
    'VRMS_TIP_MIN': fmt3v(gnss.vrms.mediana),
    'VRMS_TIP_MAX': fmt3v(gnss.vrms.p90),
    'PDOP_MIN': fmt2v(gnss.pdop.faixa_min),
    'PDOP_MAX': fmt2v(gnss.pdop.faixa_max),
    'PDOP_TIP_MIN': fmt2v(gnss.pdop.mediana),
    'PDOP_TIP_MAX': fmt2v(gnss.pdop.p90),
    'PDOP_PICOS_MIN': fmt2v(gnss.pdop.p90),
    'PDOP_PICOS_MAX': fmt2v(gnss.pdop.faixa_max),
    'VDOP_MIN': fmt2v(gnss.vdop.faixa_min),
    'VDOP_MAX': fmt2v(gnss.vdop.faixa_max),
    'VDOP_TIP_MIN': fmt2v(gnss.vdop.mediana),
    'VDOP_TIP_MAX': fmt2v(gnss.vdop.p90),
    'VDOP_PICOS_MIN': fmt2v(gnss.vdop.p90),
    'VDOP_PICOS_MAX': fmt2v(gnss.vdop.faixa_max),
    // Altimetria
    'Z_MIN': fmt3v(alt.z_min_m),
    'Z_MAX': fmt3v(alt.z_max_m),
    'Z_AMP': fmt3v(alt.amplitude_m),
    'Z_AMP_INT': fmt1v(alt.amplitude_m),
    'Z_MEDIA': fmt3v(alt.media_m),
    'Z_MEDIANA': fmt3v(alt.mediana_m),
    'Z_Q1': fmt3v(alt.q1_m),
    'Z_Q3': fmt3v(alt.q3_m),
    'Z_Q1_INT': fmt1v(alt.q1_m),
    'Z_Q3_INT': fmt1v(alt.q3_m),
    'REL_INTERP': interpretaAmplitude(alt.amplitude_m),
    // Proximidade
    'N_COM_VIZ': fmtInt(prox.pontos_com_vizinhos),
    'PCT_COM_VIZ': fmt1v(prox.pct_com_vizinhos),
    'MED_VIZ': fmt1v(prox.media_vizinhos),
    'ANOM_MEDIANA': fmt3v(prox.anomalia.mediana_m),
    'ANOM_P90': fmt3v(prox.anomalia.p90_m),
    'ANOM_P95': fmt3v(prox.anomalia.p95_m),
    'ANOM_MAX': fmt3v(prox.anomalia.maxima_m),
    'RUGOSIDADE': fmt3v(prox.rugosidade_media_m),
    'CUMES_QTD': fmtInt(prox.morfologia.Cumes.qtd),
    'CUMES_PCT': fmt1v(prox.morfologia.Cumes.pct),
    'CRISTAS_QTD': fmtInt(prox.morfologia.Cristas.qtd),
    'CRISTAS_PCT': fmt1v(prox.morfologia.Cristas.pct),
    'PLANICIES_QTD': fmtInt(prox.morfologia.Planícies.qtd),
    'PLANICIES_PCT': fmt1v(prox.morfologia.Planícies.pct),
    'TALVEGUES_QTD': fmtInt(prox.morfologia.Talvegues.qtd),
    'TALVEGUES_PCT': fmt1v(prox.morfologia.Talvegues.pct),
    'VALES_QTD': fmtInt(prox.morfologia.Vales.qtd),
    'VALES_PCT': fmt1v(prox.morfologia.Vales.pct),
    'ISOLADOS_QTD': fmtInt(prox.morfologia.Isolados.qtd),
    'ISOLADOS_PCT': fmt1v(prox.morfologia.Isolados.pct),
    'HOMOGENEIDADE': prox.homogeneidade,
    'INTERP_RUGOSIDADE': textoInterpretacaoRugosidade(prox.rugosidade_media_m, prox.raio_m),
    'INTERP_PLANICIES': textoInterpretacaoPlanicies(prox.morfologia.Planícies.pct),
    'INTERP_SIMETRIA': textoInterpretacaoSimetria(altas, baixas, prox.anomalia.p95_m),
    'TEXTO_CONCLUSAO': `O levantamento planialtimétrico cadastral realizado para o município de ${stats.municipio}-${stats.uf}, com suporte GNSS de alta precisão via PPP-RTK (GEO PPP) e processamento em ArcGIS Pro e Civil 3D 2026, resultou em uma base cadastral completa e em um MDT adequado para a geração de curvas de nível com equidistância de 0,50 m. sendo assegurada a confiabilidade posicional e altimétrica necessária ao uso em cadastro técnico e projetos executivos. As camadas de coletores, emissários e linhas de recalque foram mapeadas inclusive em áreas de mata, dentro das limitações operacionais previstas e com procedimentos de mitigação aplicados.`,
  };
  
  // Substituições com highlight
  for (const [key, value] of Object.entries(placeholders)) {
    documentXml = substituirComHighlight(documentXml, `{{${key}}}`, value);
  }
  
  // === Histograma + mapa de cotas (inseridos após "Interpretação rápida") ===
  const novosRels = [];
  let nextRelId = obterProximoRelId(relsXml);
  const figurasXml = [];
  
  const safeName = stats.municipio.replace(/[^a-zA-Z0-9]/g, '_');
  
  if (histogramaPng && fs.existsSync(histogramaPng)) {
    const relId = `rId${nextRelId++}`;
    novosRels.push({ id: relId, target: `media/histograma_${safeName}.png`, file: histogramaPng });
    figurasXml.push(
      paragrafoTexto('A figura a seguir apresenta a distribuição altimétrica dos pontos levantados:', { align: 'left' }),
      paragrafoComImagem(relId, cmToEmu(15), cmToEmu(7.9), 'center'),
      paragrafoTexto(`Figura 1 — Histograma de cotas altimétricas de ${stats.municipio}/${stats.uf}.`, {
        italic: true, size: 18, color: '595959', align: 'center'
      })
    );
  }
  
  if (mapaCotasPng && fs.existsSync(mapaCotasPng)) {
    const relId = `rId${nextRelId++}`;
    novosRels.push({ id: relId, target: `media/mapa_${safeName}.png`, file: mapaCotasPng });
    figurasXml.push(
      paragrafoTexto('A figura a seguir apresenta a distribuição espacial das cotas levantadas:', { align: 'left' }),
      paragrafoComImagem(relId, cmToEmu(15), cmToEmu(12), 'center'),
      paragrafoTexto(`Figura 2 — Distribuição espacial das cotas altimétricas em ${stats.municipio}/${stats.uf}.`, {
        italic: true, size: 18, color: '595959', align: 'center'
      })
    );
  }

  // === Modelo Digital do Terreno (MDT) em vista isométrica 3D ===
  // Gerado a partir dos MESMOS pontos do TXT (stats._pontos) via Python.
  if (mapa3dPng && fs.existsSync(mapa3dPng)) {
    const relId = `rId${nextRelId++}`;
    novosRels.push({ id: relId, target: `media/mapa3d_${safeName}.png`, file: mapa3dPng });
    figurasXml.push(
      paragrafoTexto('A figura a seguir apresenta o modelo digital do terreno (MDT) reconstruído a partir dos pontos levantados, em vista isométrica tridimensional, para leitura do relevo:', { align: 'left' }),
      paragrafoComImagem(relId, cmToEmu(16), cmToEmu(11.3), 'center'),
      paragrafoTexto(`Figura 3 — Modelo digital do terreno em vista isométrica (exagero vertical 4×) — ${stats.municipio}/${stats.uf}. Fonte: 2S Engenharia.`, {
        italic: true, size: 18, color: '595959', align: 'center'
      })
    );
  }
  
  if (figurasXml.length > 0) {
    const marcador = `Isso reforça a leitura de dispersão moderada.`;
    const idx = documentXml.indexOf(marcador);
    if (idx > -1) {
      const idxFimP = documentXml.indexOf('</w:p>', idx) + '</w:p>'.length;
      documentXml = documentXml.slice(0, idxFimP) + figurasXml.join('\n') + documentXml.slice(idxFimP);
    }
  }
  
  // === Mapa de abrangência (seção 14) ===
  let blocoMapa = '';
  if (mapaAbrangenciaPng && fs.existsSync(mapaAbrangenciaPng)) {
    const relId = `rId${nextRelId++}`;
    novosRels.push({ id: relId, target: `media/abrangencia_${safeName}.png`, file: mapaAbrangenciaPng });
    blocoMapa = paragrafoComImagem(relId, cmToEmu(13.5), cmToEmu(13), 'center');
  } else {
    blocoMapa = paragrafoTexto('[Inserir mapa de área de abrangência exportado do ArcGIS Pro ou Civil 3D]',
      { italic: true, color: '888888', align: 'center' });
  }
  documentXml = documentXml.replace(/<w:p w14:paraId="11111111"[^>]*>[\s\S]*?<\/w:p>/, blocoMapa);
  
  // === Fotos da equipe (seção 15) ===
  const relIdMapFotos = {};
  let blocoFotos = '';
  if (fotosEquipe && fotosEquipe.length > 0) {
    for (const f of fotosEquipe) {
      if (!fs.existsSync(f.caminho)) continue;
      const relId = `rId${nextRelId++}`;
      const extImg = path.extname(f.caminho).slice(1).toLowerCase();
      novosRels.push({
        id: relId,
        target: `media/foto_${crypto.randomBytes(4).toString('hex')}.${extImg}`,
        file: f.caminho
      });
      relIdMapFotos[f.caminho] = relId;
    }
    blocoFotos = tabelaFotosPorDia(fotosEquipe.filter(f => fs.existsSync(f.caminho)), stats.municipio, relIdMapFotos);
  } else {
    blocoFotos = paragrafoTexto('[Inserir fotos da equipe — 1 por equipe por dia]',
      { italic: true, color: '888888', align: 'center' });
  }
  documentXml = documentXml.replace(/<w:p w14:paraId="22222222"[^>]*>[\s\S]*?<\/w:p>/, blocoFotos);
  
  // === ART (seção 16) — múltiplas imagens ===
  let blocoArt = '';
  if (artImagens && artImagens.length > 0) {
    for (let i = 0; i < artImagens.length; i++) {
      const img = artImagens[i];
      if (!fs.existsSync(img)) continue;
      const relId = `rId${nextRelId++}`;
      const extImg = path.extname(img).slice(1).toLowerCase();
      novosRels.push({
        id: relId,
        target: `media/art_${crypto.randomBytes(4).toString('hex')}.${extImg}`,
        file: img
      });
      
      // Sub-título antes da segunda ART
      if (i === 1 && artImagens.length >= 2) {
        blocoArt += subtituloART('Anotação de Responsabilidade Técnica – ART (Corresponsável)');
      }
      blocoArt += paragrafoComImagem(relId, cmToEmu(14), cmToEmu(20.5), 'center');
    }
  } else {
    blocoArt = paragrafoTexto('[Anexar imagens da ART (PDFs convertidos em PNG, 1 por página)]',
      { italic: true, color: '888888', align: 'center' });
  }
  documentXml = documentXml.replace(/<w:p w14:paraId="33333333"[^>]*>[\s\S]*?<\/w:p>/, blocoArt);
  
  // === Atualizar relationships e content types ===
  if (novosRels.length > 0) {
    const novasRelsXml = novosRels.map(r =>
      `  <Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${r.target}"/>`
    ).join('\n');
    relsXml = relsXml.replace('</Relationships>', novasRelsXml + '\n</Relationships>');
  }
  
  for (const extImg of ['jpg', 'jpeg', 'png']) {
    if (!contentTypesXml.includes(`Extension="${extImg}"`)) {
      const ct = extImg === 'png' ? 'image/png' : 'image/jpeg';
      contentTypesXml = contentTypesXml.replace('</Types>',
        `  <Default Extension="${extImg}" ContentType="${ct}"/>\n</Types>`);
    }
  }
  
  zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
  zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf-8'));
  zip.updateFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf-8'));
  
  for (const r of novosRels) {
    if (r.file && fs.existsSync(r.file)) {
      zip.addFile(`word/${r.target}`, fs.readFileSync(r.file));
    }
  }
  
  zip.writeZip(caminhoSaida);
  return caminhoSaida;
}

module.exports = { gerarRelatorio2S };

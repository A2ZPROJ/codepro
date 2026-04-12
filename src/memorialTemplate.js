/**
 * memorialTemplate.js — Gera Memorial Descritivo a partir de um template .docx customizado.
 *
 * Usa docxtemplater para substituir placeholders no template do usuário.
 *
 * Placeholders suportados:
 *   {TITULO}           — título do projeto/orçamento
 *   {CODIGO_DOC}       — código do documento
 *   {CIDADE}           — nome da cidade
 *   {UF}               — sigla do estado
 *   {SISTEMA}          — nome do sistema
 *   {SUBBACIA}         — microbacia/área
 *   {REVISAO}          — revisão (R00, R01, etc.)
 *   {DATA}             — data do orçamento
 *   {ELABORADOR}       — nome do elaborador
 *   {ENG_RESPONSAVEL}  — engenheiro responsável
 *   {ENG_CREA}         — CREA do engenheiro
 *   {ART}              — número da ART
 *   {CONTRATO}         — número do contrato
 *   {ETE_DESTINO}      — nome da ETE de destino
 *   {EMPRESA}          — nome da empresa
 *
 * Placeholders de dados (da conferência OSE):
 *   {N_OSES}           — total de OSEs
 *   {L_TOTAL}          — extensão total da rede (m)
 *   {N_PVS}            — nº de PVs
 *   {N_TLS}            — nº de TLs
 *   {N_TQS}            — nº de tubos de queda
 *   {PVS_0_2}          — PVs com prof 0-2m
 *   {PVS_2_3}          — PVs com prof 2-3m
 *   {PVS_3_4}          — PVs com prof 3-4m
 *   {PVS_4PLUS}        — PVs com prof >4m
 */
'use strict';

const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

function generateFromTemplate(templatePath, info, oseAgg) {
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
  });

  // Monta o objeto de dados com todos os placeholders
  const data = {
    TITULO:          info.titulo || '',
    CODIGO_DOC:      info.codigo_documento || '',
    CIDADE:          info.cidade || '',
    UF:              info.uf || '',
    SISTEMA:         info.sistema || '',
    SUBBACIA:        info.microbacia || '',
    REVISAO:         info.revisao || '',
    DATA:            info.data_orcamento || '',
    ELABORADOR:      info.elaborador || '',
    ENG_RESPONSAVEL: info.eng_responsavel || '',
    ENG_CREA:        info.eng_crea || '',
    ART:             info.art || '',
    CONTRATO:        info.contrato || '',
    ETE_DESTINO:     info.ete_destino || '',
    EMPRESA:         info.empresa || '',
    // Dados da conferência OSE
    N_OSES:    oseAgg ? String(oseAgg.oses_total || 0) : '—',
    L_TOTAL:   oseAgg ? (oseAgg.L_total || 0).toFixed(2) : '—',
    N_PVS:     oseAgg ? String(oseAgg.pvs_count || 0) : '—',
    N_TLS:     oseAgg ? String(oseAgg.tls_count || 0) : '—',
    N_TQS:     oseAgg ? String(oseAgg.tqs_count || 0) : '—',
    PVS_0_2:   oseAgg && oseAgg.pvs_por_faixa ? String(oseAgg.pvs_por_faixa['0-2'] || 0) : '0',
    PVS_2_3:   oseAgg && oseAgg.pvs_por_faixa ? String(oseAgg.pvs_por_faixa['2-3'] || 0) : '0',
    PVS_3_4:   oseAgg && oseAgg.pvs_por_faixa ? String(oseAgg.pvs_por_faixa['3-4'] || 0) : '0',
    PVS_4PLUS: oseAgg && oseAgg.pvs_por_faixa ? String(oseAgg.pvs_por_faixa['4+']  || 0) : '0',
  };

  doc.render(data);

  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  return buf;
}

module.exports = { generateFromTemplate };

/**
 * Orquestrador do módulo Topografia 2S no Nexus (V3).
 * 
 * Pipeline:
 *   1. Lê TXTs GNSS RTK da pasta da cidade
 *   2. Calcula estatísticas padrão 2S (altimetria, GNSS, proximidade)
 *   3. Gera histograma + mapa de cotas (PNG via @napi-rs/canvas)
 *   4. Produz .docx no formato RT da 2S Engenharia (template-based)
 *      - Valores dinâmicos em HIGHLIGHT AMARELO
 *      - Fotos por dia (1 linha = 1 dia, 2 colunas = 2 equipes)
 *      - 2 ARTs (principal + corresponsável)
 *      - Mapa de área de abrangência opcional
 */

const path = require('path');
const fs = require('fs');
const { processarCidade } = require('./processador_topografia');
const { gerarHistogramaCotas, gerarMapaCotas, gerarMapa3D } = require('./gerador_graficos');
const { gerarRelatorio2S } = require('./gerador_relatorio');

const PASTA_ASSETS = path.join(__dirname, '..', 'assets');
const TEMPLATE_PADRAO = path.join(PASTA_ASSETS, 'template_2s.docx');

/**
 * Gera relatório de uma cidade.
 * 
 * @param {object} params
 * @param {string} params.pastaCidade - Pasta com TXTs (varredura recursiva)
 * @param {string} params.municipio
 * @param {string} [params.uf='PR']
 * @param {string} params.pastaSaida
 * @param {number} [params.extensaoKm] - vem da planilha Medição
 * @param {string} [params.mapaAbrangenciaPng] - PNG exportado do ArcGIS/Civil 3D (seção 14)
 * @param {Array<{caminho,data,equipe?}>} [params.fotosEquipe] - fotos 1 por equipe por dia
 * @param {Array<string>} [params.artImagens] - PNGs das ARTs (PDF → PNG antes via pdf-to-png-converter)
 * @param {boolean} [params.gerarGraficos=true]
 * @param {string} [params.templatePath]
 * @param {function} [params.onProgresso]
 */
async function gerarRelatorioCidade(params) {
  const {
    pastaCidade, municipio, uf = 'PR', pastaSaida,
    extensaoKm, mapaAbrangenciaPng, fotosEquipe = [], artImagens = [],
    gerarGraficos = true,
    incluirMapa3D = true,
    templatePath = TEMPLATE_PADRAO,
    onProgresso = () => {},
  } = params;

  if (!fs.existsSync(pastaCidade)) throw new Error(`Pasta não encontrada: ${pastaCidade}`);
  if (!fs.existsSync(templatePath)) throw new Error(`Template não encontrado: ${templatePath}`);
  if (!fs.existsSync(pastaSaida)) fs.mkdirSync(pastaSaida, { recursive: true });

  onProgresso('Lendo arquivos TXT', 20);
  const stats = await processarCidade(pastaCidade, { municipio, uf });

  let histogramaPng = null, mapaCotasPng = null, mapa3dPng = null;
  if (gerarGraficos) {
    onProgresso('Gerando histograma de cotas', 45);
    histogramaPng = path.join(pastaSaida, `${municipio}_histograma.png`);
    gerarHistogramaCotas(stats, histogramaPng);

    onProgresso('Gerando mapa de cotas', 60);
    mapaCotasPng = path.join(pastaSaida, `${municipio}_mapa.png`);
    gerarMapaCotas(stats, mapaCotasPng);

    if (incluirMapa3D) {
      onProgresso('Gerando modelo 3D do terreno', 75);
      const alvo3d = path.join(pastaSaida, `${municipio}_mapa3d.png`);
      // Alimentado pelos MESMOS pontos do TXT (stats._pontos). Se falhar
      // (Python ausente, erro), retorna null e o relatório segue sem o 3D.
      mapa3dPng = gerarMapa3D(stats, alvo3d);
    }
  }

  onProgresso('Gerando relatório DOCX (padrão 2S)', 90);
  const caminhoDocx = path.join(pastaSaida, `Relatorio_Topografia_${municipio}.docx`);
  await gerarRelatorio2S(stats, caminhoDocx, {
    templatePath, histogramaPng, mapaCotasPng, mapa3dPng, mapaAbrangenciaPng,
    fotosEquipe, artImagens, extensaoKm,
  });

  onProgresso('Concluído', 100);
  const statsLimpo = { ...stats };
  delete statsLimpo._pontos;
  return { stats: statsLimpo, caminhoDocx, histogramaPng, mapaCotasPng, mapa3dPng };
}

async function gerarRelatoriosLote(cidades, pastaSaida, opts = {}) {
  const resultados = [];
  for (let i = 0; i < cidades.length; i++) {
    const c = cidades[i];
    try {
      const r = await gerarRelatorioCidade({
        ...c, pastaSaida,
        gerarGraficos: opts.gerarGraficos !== false,
        templatePath: opts.templatePath,
        onProgresso: (etapa, pct) => {
          if (opts.onProgressoLote) opts.onProgressoLote(c.municipio, i, cidades.length, etapa, pct);
        },
      });
      resultados.push({ municipio: c.municipio, sucesso: true, caminhoDocx: r.caminhoDocx });
    } catch (err) {
      resultados.push({ municipio: c.municipio, sucesso: false, erro: err.message });
    }
  }
  return resultados;
}

module.exports = { gerarRelatorioCidade, gerarRelatoriosLote };

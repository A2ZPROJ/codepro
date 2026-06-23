/**
 * Processador de Topografia — Padrão 2S Engenharia
 * 
 * Implementa exatamente as análises descritas nos relatórios da 2S:
 *   - Caracterização altimétrica global (min, max, amplitude, média, mediana, Q1, Q3)
 *   - Estatísticas de qualidade GNSS (HRMS, VRMS, PDOP, VDOP) por faixa e típicos
 *   - Análise altimétrica por proximidade em raio de 30 m:
 *       * anomalia local (mediana, P90, P95, máxima)
 *       * rugosidade local média
 *   - Classificação morfológica dos pontos:
 *       Cumes / Cristas / Planícies / Talvegues / Vales / Isolados
 *   - Classificação de homogeneidade: HOMOGÊNEO / MODERADO / HETEROGÊNEO
 * 
 * Formato esperado de cada linha do TXT GNSS:
 *   col 0: nº sequencial   col 1: código       col 2: N         col 3: E      col 4: Z
 *   col 5: PDOP            col 6: HDOP         col 7: VDOP      col 8: HRMS   col 9: VRMS
 *   col 10-11: lat, long   col 14: status      col 17: timestamp ISO
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ============================================================
// PARSE DO TXT
// ============================================================

async function parseArquivoTXT(caminhoArquivo) {
  const pontos = [];
  const stream = fs.createReadStream(caminhoArquivo, { encoding: 'latin1' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const linha of rl) {
    if (!linha.trim()) continue;
    const cols = linha.split(',');
    if (cols.length < 18) continue;

    const n = parseFloat(cols[2]);
    const e = parseFloat(cols[3]);
    const z = parseFloat(cols[4]);
    if (!isFinite(n) || !isFinite(e) || !isFinite(z)) continue;

    pontos.push({
      n, e, z,
      pdop: parseFloat(cols[5]),
      hdop: parseFloat(cols[6]),
      vdop: parseFloat(cols[7]),
      hrms: parseFloat(cols[8]),
      vrms: parseFloat(cols[9]),
      status: (cols[14] || '').trim(),
      ts: (cols[17] || '').trim(),
    });
  }
  return pontos;
}

function metadadosDoNome(nomeArquivo) {
  // Aceita variações: "Equipe_01", "EQUIPE 01", "Equipe-01", "EQUIPE01"
  const m = nomeArquivo.match(/(\d{2})-(\d{2})-(\d{4})-(?:EQUIPE|Equipe)[ _-]*(\d+)/i);
  if (!m) return { equipe: '?', dataNome: '?' };
  return {
    dataNome: `${m[1]}/${m[2]}/${m[3]}`,
    equipe: `Equipe ${String(parseInt(m[4], 10)).padStart(2, '0')}`,
  };
}

function dataDoTimestamp(ts) {
  if (!ts) return null;
  const m = ts.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

// ============================================================
// ESTATÍSTICAS BÁSICAS
// ============================================================

function mediana(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function media(arr) { return arr.reduce((s, v) => s + v, 0) / arr.length; }
function desvioPadrao(arr) {
  const m = media(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
function percentil(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

// ============================================================
// FILTRO DE OUTLIERS
// ============================================================

function filtrarOutliers(pontos, opts = {}) {
  const raioMax = opts.raioMaxMetros || 5000;
  const fatorZ = opts.fatorDesvioZ || 4;

  const nMed = mediana(pontos.map(p => p.n));
  const eMed = mediana(pontos.map(p => p.e));

  const passou1 = [];
  let removidosEspacial = 0;
  for (const p of pontos) {
    if (Math.hypot(p.n - nMed, p.e - eMed) <= raioMax) passou1.push(p);
    else removidosEspacial++;
  }

  const zArr = passou1.map(p => p.z);
  const zMed = mediana(zArr);
  const zStd = desvioPadrao(zArr);

  const passou2 = [];
  let removidosAltimetria = 0;
  for (const p of passou1) {
    if (Math.abs(p.z - zMed) <= fatorZ * zStd) passou2.push(p);
    else removidosAltimetria++;
  }

  return { pontosFiltrados: passou2, removidosEspacial, removidosAltimetria };
}

// ============================================================
// GRID ESPACIAL (para busca de vizinhos)
// ============================================================

function construirGrid(pontos, cell = 30) {
  const grid = new Map();
  for (let idx = 0; idx < pontos.length; idx++) {
    const p = pontos[idx];
    const i = Math.floor(p.n / cell), j = Math.floor(p.e / cell);
    const k = `${i},${j}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(idx);
  }
  return { grid, cell };
}

function vizinhosNoRaio(p, raio, gridObj, pontos) {
  const { grid, cell } = gridObj;
  const i0 = Math.floor(p.n / cell), j0 = Math.floor(p.e / cell);
  const r = Math.ceil(raio / cell);
  const vizinhos = [];
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      const lista = grid.get(`${i0 + di},${j0 + dj}`);
      if (!lista) continue;
      for (const idx of lista) {
        const q = pontos[idx];
        const d = Math.hypot(p.n - q.n, p.e - q.e);
        if (d > 0 && d <= raio) vizinhos.push({ idx, d, z: q.z });
      }
    }
  }
  return vizinhos;
}

// ============================================================
// ANÁLISE ALTIMÉTRICA POR PROXIMIDADE (PADRÃO 2S)
// ============================================================

/**
 * Para cada ponto:
 *   - encontra vizinhos no raio de 30 m
 *   - calcula anomalia local = |Z_ponto - média(Z_vizinhos)|
 *   - calcula rugosidade local = std(Z_vizinhos)
 * Classifica morfologicamente:
 *   - Isolado: < 3 vizinhos
 *   - Cume: ponto > média + 1.5*std dos vizinhos
 *   - Crista: ponto > média + 0.5*std
 *   - Vale: ponto < média - 1.5*std
 *   - Talvegue: ponto < média - 0.5*std
 *   - Planície: caso contrário
 */
function analiseProximidade(pontos, raio = 30, minVizinhos = 3) {
  const gridObj = construirGrid(pontos, raio);
  
  const anomalias = [];
  const rugosidades = [];
  const numVizinhosArr = [];
  let comVizinhosSuficientes = 0;
  
  const contagem = {
    'Cumes': 0,
    'Cristas': 0,
    'Planícies': 0,
    'Talvegues': 0,
    'Vales': 0,
    'Isolados': 0,
  };
  
  for (const p of pontos) {
    const viz = vizinhosNoRaio(p, raio, gridObj, pontos);
    numVizinhosArr.push(viz.length);
    
    if (viz.length < minVizinhos) {
      contagem.Isolados++;
      continue;
    }
    
    comVizinhosSuficientes++;
    const zsViz = viz.map(v => v.z);
    const medZ = media(zsViz);
    const stdZ = desvioPadrao(zsViz);
    const anom = Math.abs(p.z - medZ);
    anomalias.push(anom);
    rugosidades.push(stdZ);
    
    // Classificação morfológica
    const diff = p.z - medZ;
    if (stdZ < 0.01) {
      contagem.Planícies++;
    } else if (diff > 1.5 * stdZ) {
      contagem.Cumes++;
    } else if (diff > 0.5 * stdZ) {
      contagem.Cristas++;
    } else if (diff < -1.5 * stdZ) {
      contagem.Vales++;
    } else if (diff < -0.5 * stdZ) {
      contagem.Talvegues++;
    } else {
      contagem.Planícies++;
    }
  }
  
  // Rugosidade média
  const rugosidadeMedia = rugosidades.length > 0 ? media(rugosidades) : 0;
  
  // Classificação de homogeneidade baseada na rugosidade média
  let homogeneidade;
  if (rugosidadeMedia < 0.80) homogeneidade = 'HOMOGÊNEO';
  else if (rugosidadeMedia < 2.00) homogeneidade = 'MODERADO';
  else homogeneidade = 'HETEROGÊNEO';
  
  return {
    total_pontos: pontos.length,
    pontos_com_vizinhos: comVizinhosSuficientes,
    pct_com_vizinhos: +(100 * comVizinhosSuficientes / pontos.length).toFixed(1),
    raio_m: raio,
    media_vizinhos: +media(numVizinhosArr).toFixed(1),
    anomalia: {
      mediana_m: anomalias.length ? +mediana(anomalias).toFixed(3) : 0,
      p90_m: anomalias.length ? +percentil(anomalias, 90).toFixed(3) : 0,
      p95_m: anomalias.length ? +percentil(anomalias, 95).toFixed(3) : 0,
      maxima_m: anomalias.length ? +Math.max(...anomalias).toFixed(3) : 0,
    },
    rugosidade_media_m: +rugosidadeMedia.toFixed(3),
    morfologia: {
      Cumes: { qtd: contagem.Cumes, pct: +(100 * contagem.Cumes / pontos.length).toFixed(1) },
      Cristas: { qtd: contagem.Cristas, pct: +(100 * contagem.Cristas / pontos.length).toFixed(1) },
      Planícies: { qtd: contagem.Planícies, pct: +(100 * contagem.Planícies / pontos.length).toFixed(1) },
      Talvegues: { qtd: contagem.Talvegues, pct: +(100 * contagem.Talvegues / pontos.length).toFixed(1) },
      Vales: { qtd: contagem.Vales, pct: +(100 * contagem.Vales / pontos.length).toFixed(1) },
      Isolados: { qtd: contagem.Isolados, pct: +(100 * contagem.Isolados / pontos.length).toFixed(1) },
    },
    homogeneidade,
  };
}

// ============================================================
// ESTATÍSTICAS GNSS (HRMS, VRMS, PDOP, VDOP)
// ============================================================

function estatisticasGNSS(pontos) {
  function statsCol(col, dec = 3) {
    const valores = pontos.map(p => p[col]).filter(v => isFinite(v));
    if (valores.length === 0) return null;
    return {
      faixa_min: +Math.min(...valores).toFixed(dec),
      faixa_max: +Math.max(...valores).toFixed(dec),
      mediana: +mediana(valores).toFixed(dec),
      p90: +percentil(valores, 90).toFixed(dec),
    };
  }
  return {
    hrms: statsCol('hrms', 3),
    vrms: statsCol('vrms', 3),
    pdop: statsCol('pdop', 2),
    vdop: statsCol('vdop', 2),
  };
}

// ============================================================
// PROCESSAMENTO COMPLETO
// ============================================================

async function processarCidade(pastaCidade, opts = {}) {
  const recursivo = opts.recursivo !== false;
  const municipio = opts.municipio || path.basename(pastaCidade);
  const uf = opts.uf || 'PR';
  const raioAnalise = opts.raioAnalise || 30;
  
  function listarTXT(dir) {
    const arquivos = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const caminho = path.join(dir, item.name);
      if (item.isDirectory() && recursivo) arquivos.push(...listarTXT(caminho));
      else if (item.isFile() && item.name.toLowerCase().endsWith('.txt'))
        arquivos.push(caminho);
    }
    return arquivos;
  }
  
  const arquivos = listarTXT(pastaCidade);
  if (arquivos.length === 0) throw new Error(`Nenhum .txt encontrado em ${pastaCidade}`);
  
  // Parse
  const pontosTodos = [];
  const detalhePorArquivo = [];
  
  for (const caminho of arquivos) {
    const nome = path.basename(caminho);
    const pontos = await parseArquivoTXT(caminho);
    if (pontos.length === 0) continue;
    
    const meta = metadadosDoNome(nome);
    const dataReal = dataDoTimestamp(pontos[0].ts) || meta.dataNome;
    
    const zs = pontos.map(p => p.z);
    detalhePorArquivo.push({
      arquivo: nome,
      data_levantamento: dataReal,
      equipe: meta.equipe,
      pontos: pontos.length,
      z_min_m: +Math.min(...zs).toFixed(3),
      z_max_m: +Math.max(...zs).toFixed(3),
    });
    
    for (const p of pontos) pontosTodos.push(p);
  }
  
  // Filtros
  const { pontosFiltrados, removidosEspacial, removidosAltimetria } = filtrarOutliers(pontosTodos);
  
  // Caracterização altimétrica global
  const Z = pontosFiltrados.map(p => p.z);
  const N = pontosFiltrados.map(p => p.n);
  const E = pontosFiltrados.map(p => p.e);
  
  const altimetria = {
    z_min_m: +Math.min(...Z).toFixed(3),
    z_max_m: +Math.max(...Z).toFixed(3),
    amplitude_m: +(Math.max(...Z) - Math.min(...Z)).toFixed(3),
    media_m: +media(Z).toFixed(3),
    mediana_m: +mediana(Z).toFixed(3),
    q1_m: +percentil(Z, 25).toFixed(3),
    q3_m: +percentil(Z, 75).toFixed(3),
  };
  
  // Estatísticas GNSS
  const gnss = estatisticasGNSS(pontosFiltrados);
  
  // Análise por proximidade (padrão 2S)
  const proximidade = analiseProximidade(pontosFiltrados, raioAnalise, 3);
  
  // Extensão
  const extensao = {
    ns_m: +(Math.max(...N) - Math.min(...N)).toFixed(1),
    ew_m: +(Math.max(...E) - Math.min(...E)).toFixed(1),
    ns_km: +((Math.max(...N) - Math.min(...N)) / 1000).toFixed(2),
    ew_km: +((Math.max(...E) - Math.min(...E)) / 1000).toFixed(2),
  };
  
  // Datas e equipes
  const datas = [...new Set(detalhePorArquivo.map(d => d.data_levantamento))].sort((a, b) => {
    const [da, ma, ya] = a.split('/').map(Number);
    const [db, mb, yb] = b.split('/').map(Number);
    return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
  });
  const equipes = [...new Set(detalhePorArquivo.map(d => d.equipe))].sort();
  
  return {
    municipio, uf,
    filtros_aplicados: {
      outliers_espaciais_removidos: removidosEspacial,
      outliers_altimetricos_removidos: removidosAltimetria,
    },
    total_pontos: pontosFiltrados.length,
    n_arquivos: detalhePorArquivo.length,
    datas_levantamento: datas,
    equipes,
    extensao_levantamento: extensao,
    altimetria,
    gnss,
    proximidade,
    detalhe_por_arquivo: detalhePorArquivo,
    _pontos: pontosFiltrados,
  };
}

module.exports = {
  processarCidade,
  parseArquivoTXT,
  filtrarOutliers,
  analiseProximidade,
  estatisticasGNSS,
  metadadosDoNome,
  dataDoTimestamp,
};

/**
 * Gerador de gráficos para o relatório 2S.
 * 
 * Usa @napi-rs/canvas (build pré-compilado, sem cairo/pango).
 * Gera dois PNGs por cidade:
 *   - Histograma de cotas altimétricas
 *   - Mapa de distribuição espacial das cotas (scatter colorido por Z)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { createCanvas } = require('@napi-rs/canvas');

const COR_PRINCIPAL = '#1A1A1A';
const COR_ACENTO = '#8B0000';
const COR_GRID = '#CCCCCC';
const COR_TEXTO = '#262626';

// ============================================================
// HISTOGRAMA DE COTAS
// ============================================================

function gerarHistogramaCotas(stats, caminhoSaida) {
  const Z = stats._pontos.map(p => p.z);
  const zMin = Math.min(...Z), zMax = Math.max(...Z);
  const nBins = 40;
  const passo = (zMax - zMin) / nBins;

  const bins = new Array(nBins).fill(0);
  for (const z of Z) {
    let idx = Math.floor((z - zMin) / passo);
    if (idx >= nBins) idx = nBins - 1;
    if (idx < 0) idx = 0;
    bins[idx]++;
  }
  const maxBin = Math.max(...bins);

  const W = 1200, H = 630;
  const ML = 90, MR = 30, MT = 70, MB = 70;
  const PW = W - ML - MR;
  const PH = H - MT - MB;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fundo branco
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Título
  ctx.fillStyle = COR_PRINCIPAL;
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Distribuição altimétrica dos pontos levantados — ${stats.municipio}/${stats.uf}`, W / 2, 35);

  // Grid + ticks Y
  ctx.strokeStyle = COR_GRID;
  ctx.lineWidth = 1;
  ctx.font = '14px Arial, sans-serif';
  ctx.fillStyle = COR_TEXTO;
  ctx.textAlign = 'right';
  const nTicksY = 6;
  for (let i = 0; i <= nTicksY; i++) {
    const val = Math.round(maxBin * i / nTicksY);
    const y = MT + PH - (PH * i / nTicksY);
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(ML, y);
    ctx.lineTo(ML + PW, y);
    ctx.stroke();
    ctx.fillText(val.toLocaleString('pt-BR'), ML - 8, y + 5);
  }
  ctx.setLineDash([]);

  // Eixos
  ctx.strokeStyle = COR_TEXTO;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(ML, MT);
  ctx.lineTo(ML, MT + PH);
  ctx.lineTo(ML + PW, MT + PH);
  ctx.stroke();

  // Barras
  ctx.fillStyle = COR_PRINCIPAL;
  const wBar = PW / nBins;
  for (let i = 0; i < nBins; i++) {
    const hBar = (bins[i] / maxBin) * PH;
    ctx.fillRect(ML + i * wBar + 1, MT + PH - hBar, wBar - 1, hBar);
  }

  // Linha da média
  const zMedio = Z.reduce((s, v) => s + v, 0) / Z.length;
  const xMedia = ML + ((zMedio - zMin) / (zMax - zMin)) * PW;
  ctx.strokeStyle = COR_ACENTO;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(xMedia, MT);
  ctx.lineTo(xMedia, MT + PH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Linha da mediana
  const sorted = [...Z].sort((a, b) => a - b);
  const zMediana = sorted[Math.floor(sorted.length / 2)];
  const xMediana = ML + ((zMediana - zMin) / (zMax - zMin)) * PW;
  ctx.strokeStyle = '#7A7A7A';
  ctx.lineWidth = 2;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(xMediana, MT);
  ctx.lineTo(xMediana, MT + PH);
  ctx.stroke();
  ctx.setLineDash([]);

  // Ticks X
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '13px Arial, sans-serif';
  ctx.textAlign = 'center';
  const nTicksX = 7;
  for (let i = 0; i <= nTicksX; i++) {
    const z = zMin + ((zMax - zMin) * i / nTicksX);
    const x = ML + (PW * i / nTicksX);
    ctx.fillText(z.toFixed(1), x, MT + PH + 22);
  }

  // Rótulos eixos
  ctx.font = '14px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Cota altimétrica (m)', ML + PW / 2, H - 20);
  ctx.save();
  ctx.translate(25, MT + PH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Quantidade de pontos', 0, 0);
  ctx.restore();

  // Legenda (canto superior direito do plot)
  const lx = ML + PW - 200;
  const ly = MT + 15;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(lx, ly, 195, 50);
  ctx.strokeStyle = COR_GRID;
  ctx.strokeRect(lx, ly, 195, 50);

  ctx.strokeStyle = COR_ACENTO;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(lx + 8, ly + 15);
  ctx.lineTo(lx + 40, ly + 15);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '12px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`Média = ${zMedio.toFixed(1)} m`, lx + 48, ly + 19);

  ctx.strokeStyle = '#7A7A7A';
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(lx + 8, ly + 35);
  ctx.lineTo(lx + 40, ly + 35);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillText(`Mediana = ${zMediana.toFixed(1)} m`, lx + 48, ly + 39);

  fs.writeFileSync(caminhoSaida, canvas.toBuffer('image/png'));
  return caminhoSaida;
}

// ============================================================
// MAPA DE DISTRIBUIÇÃO ESPACIAL DAS COTAS
// ============================================================

function corPorZ(t) {
  // Paleta tipo "terrain" simplificada
  if (t < 0.2) return `rgba(70, 130, 200, 0.85)`;       // azul (vales)
  if (t < 0.4) return `rgba(120, 180, 130, 0.85)`;      // verde
  if (t < 0.6) return `rgba(200, 200, 110, 0.85)`;      // amarelo
  if (t < 0.8) return `rgba(180, 150, 100, 0.85)`;      // marrom
  return `rgba(220, 200, 180, 0.85)`;                    // claro (cumes)
}

function gerarMapaCotas(stats, caminhoSaida) {
  const pontos = stats._pontos;
  const passoAmostra = Math.max(1, Math.floor(pontos.length / 10000));
  const amostra = [];
  for (let i = 0; i < pontos.length; i += passoAmostra) amostra.push(pontos[i]);

  const Z = amostra.map(p => p.z);
  const N = amostra.map(p => p.n);
  const E = amostra.map(p => p.e);
  const zMin = Math.min(...Z), zMax = Math.max(...Z);
  const nMin = Math.min(...N), nMax = Math.max(...N);
  const eMin = Math.min(...E), eMax = Math.max(...E);

  // Aspecto 1:1 (preserva proporção geográfica)
  const dE = eMax - eMin, dN = nMax - nMin;
  const aspect = dE / dN;

  const W = 1200;
  let plotW, plotH, ML, MT;
  if (aspect >= 1) {
    plotW = 950;
    plotH = plotW / aspect;
  } else {
    plotH = 750;
    plotW = plotH * aspect;
  }
  const H = plotH + 200;
  ML = Math.max(110, (W - plotW - 80) / 2);
  MT = 70;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fundo branco
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Título
  ctx.fillStyle = COR_PRINCIPAL;
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`Distribuição espacial das cotas — ${stats.municipio}/${stats.uf}`, W / 2, 35);

  // Grid
  ctx.strokeStyle = COR_GRID;
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  const nGrid = 5;
  for (let i = 1; i < nGrid; i++) {
    const y = MT + (plotH * i / nGrid);
    ctx.beginPath();
    ctx.moveTo(ML, y);
    ctx.lineTo(ML + plotW, y);
    ctx.stroke();
    const x = ML + (plotW * i / nGrid);
    ctx.beginPath();
    ctx.moveTo(x, MT);
    ctx.lineTo(x, MT + plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Moldura
  ctx.strokeStyle = COR_TEXTO;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(ML, MT, plotW, plotH);

  // Pontos
  for (let i = 0; i < amostra.length; i++) {
    const x = ML + ((E[i] - eMin) / dE) * plotW;
    const y = MT + plotH - ((N[i] - nMin) / dN) * plotH;
    const t = (Z[i] - zMin) / (zMax - zMin);
    ctx.fillStyle = corPorZ(t);
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ticks
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '12px Arial, sans-serif';
  ctx.textAlign = 'center';
  for (let i = 0; i <= nGrid; i++) {
    const e = eMin + (dE * i / nGrid);
    const x = ML + (plotW * i / nGrid);
    ctx.fillText(e.toFixed(0), x, MT + plotH + 18);
  }
  ctx.textAlign = 'right';
  for (let i = 0; i <= nGrid; i++) {
    const n = nMin + (dN * i / nGrid);
    const y = MT + plotH - (plotH * i / nGrid);
    ctx.fillText(n.toFixed(0), ML - 8, y + 4);
  }

  // Rótulos eixos
  ctx.font = '14px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Coordenada E (UTM, m)', ML + plotW / 2, MT + plotH + 45);
  ctx.save();
  ctx.translate(ML - 60, MT + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Coordenada N (UTM, m)', 0, 0);
  ctx.restore();

  // Barra de cores (colorbar à direita)
  const cbX = ML + plotW + 20;
  const cbY = MT + 30;
  const cbW = 18;
  const cbH = plotH - 60;
  const nSteps = 100;
  for (let i = 0; i < nSteps; i++) {
    const t = i / nSteps;
    ctx.fillStyle = corPorZ(t);
    ctx.fillRect(cbX, cbY + cbH - (cbH * (i + 1) / nSteps), cbW, cbH / nSteps + 1);
  }
  ctx.strokeStyle = COR_TEXTO;
  ctx.strokeRect(cbX, cbY, cbW, cbH);
  ctx.fillStyle = COR_TEXTO;
  ctx.font = '11px Arial, sans-serif';
  ctx.textAlign = 'left';
  const nTicksCb = 5;
  for (let i = 0; i <= nTicksCb; i++) {
    const z = zMin + ((zMax - zMin) * i / nTicksCb);
    const y = cbY + cbH - (cbH * i / nTicksCb);
    ctx.fillText(z.toFixed(0), cbX + cbW + 4, y + 4);
  }
  ctx.save();
  ctx.translate(cbX + cbW + 38, cbY + cbH / 2);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText('Cota (m)', 0, 0);
  ctx.restore();

  fs.writeFileSync(caminhoSaida, canvas.toBuffer('image/png'));
  return caminhoSaida;
}

// ============================================================
// MAPA 3D DO TERRENO (MDT em vista isométrica)
// ============================================================
// O 3D exige matplotlib/scipy (interpolação + LightSource), que o canvas JS
// não faz. Geramos via Python (mapa_3d_topo.py) alimentado pelos MESMOS pontos
// do TXT que o relatório usa (stats._pontos -> arquivo temp X Y Z).

const PYTHON_CANDIDATES_3D = [
  process.env.NEXUS_PYTHON || '',
  'C:\\Users\\lcabd\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
  'C:\\Users\\lcabd\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
  'C:\\Users\\lcabd\\AppData\\Local\\Programs\\Python\\Python311\\python.exe',
];

function resolverPython3D() {
  for (const c of PYTHON_CANDIDATES_3D) {
    if (c && fs.existsSync(c)) return c;
  }
  // 'python'/'py' no PATH
  for (const cmd of ['python', 'py']) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore', windowsHide: true });
      return cmd;
    } catch (_) { /* tenta o próximo */ }
  }
  return null;
}

/**
 * Gera o PNG do MDT 3D (vista isométrica) a partir de stats._pontos.
 * Retorna o caminho do PNG, ou null se não foi possível (Python ausente,
 * erro, poucos pontos). Nunca lança — o relatório segue sem o 3D.
 */
function gerarMapa3D(stats, caminhoSaida, opts = {}) {
  try {
    const pontos = stats._pontos || [];
    if (pontos.length < 4) return null;

    const py = resolverPython3D();
    if (!py) {
      console.warn('[topografia] Python não encontrado — mapa 3D ignorado.');
      return null;
    }

    const script = path.join(__dirname, 'mapa_3d_topo.py');
    if (!fs.existsSync(script)) {
      console.warn('[topografia] mapa_3d_topo.py não encontrado — mapa 3D ignorado.');
      return null;
    }

    // Escreve os pontos do TXT (X=E, Y=N, Z) num arquivo temp "X Y Z".
    const ptsFile = path.join(os.tmpdir(),
      `nexus_topo3d_${Date.now()}_${Math.floor(Math.random() * 1e6)}.xyz`);
    const linhas = new Array(pontos.length);
    for (let i = 0; i < pontos.length; i++) {
      const p = pontos[i];
      linhas[i] = `${p.e} ${p.n} ${p.z}`;
    }
    fs.writeFileSync(ptsFile, linhas.join('\n'), 'utf-8');

    const r = spawnSync(py, [
      script, ptsFile, caminhoSaida,
      stats.municipio || '', stats.uf || '',
    ], { windowsHide: true, encoding: 'utf-8', timeout: opts.timeout || 180000 });

    try { fs.unlinkSync(ptsFile); } catch (_) {}

    if (r.status !== 0 || !fs.existsSync(caminhoSaida)) {
      console.warn('[topografia] mapa 3D falhou:',
        (r.stderr || r.stdout || `código ${r.status}`).slice(-600));
      return null;
    }
    return caminhoSaida;
  } catch (e) {
    console.warn('[topografia] erro ao gerar mapa 3D:', e.message);
    return null;
  }
}

module.exports = { gerarHistogramaCotas, gerarMapaCotas, gerarMapa3D };

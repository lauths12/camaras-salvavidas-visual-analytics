(function () {
'use strict';

const C = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const nf = (v, d = 1) => d3.format(`,.${d}f`)(v).replace(/,/g, ' ').replace('.', ',').replace(/ /g, '.');
const fmt = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), d);
const pretty = n => (n || '').trim();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dur = ms => reduced ? 0 : ms;

const tipEl = d3.select('#tip');
function tipShow(html, ev) {
  tipEl.html(html).style('opacity', 1);
  const w = tipEl.node().offsetWidth, h = tipEl.node().offsetHeight;
  let x = ev.clientX + 16, y = ev.clientY + 16;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 16;
  if (y + h > innerHeight - 8) y = ev.clientY - h - 16;
  tipEl.style('left', x + 'px').style('top', y + 'px');
}
const tipHide = () => tipEl.style('opacity', 0);

let DATA, sitioById, rankByCorredor, ratioCiudad, maxDiff;

Promise.all([
  d3.json('data/sitios.json'), d3.json('data/camaras.json'), d3.json('data/tramos.geojson'),
  d3.json('data/corredores_ranking.json'), d3.json('data/tendencia.json'),
  d3.json('data/heatmap.json'), d3.json('data/efecto_promedio.json'),
  d3.json('data/exposicion_camaras.json'), d3.json('data/gravedad_franja.json'), d3.json('data/calidad.json')
]).then(([sitios, camaras, tramos, ranking, tendencia, heat, efecto, exposicion, gravedad, calidad]) => {
  DATA = { sitios, camaras, tramos, ranking, tendencia, heat, efecto, exposicion, gravedad, calidad };
  sitioById = new Map(sitios.map(s => [s.sitio, s]));
  rankByCorredor = new Map(ranking.map(r => [r.corredor, r]));
  ratioCiudad = 1 + (ranking[0] ? ranking[0].cambio_pct_ciudad / 100 : 1);
  maxDiff = d3.max(ranking, r => Math.abs(r.despues - r.antes * ratioCiudad)) || 1;
  tramos.features.forEach(f => { f.properties.camaras_km = f.properties.distancia_m > 0 ? f.properties.n_camaras / (f.properties.distancia_m / 1000) : 0; });
  drawHero();
  initStory();
  initExplorer();
  drawHeat();
  drawTrend();
  drawEffect();
  drawDose();
  drawVelGrav();
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { drawHero(); drawTrend(); drawEffect(); drawDose(); drawHeat(); drawRank(); drawSide(); }, 200); });
}).catch(err => {
  document.body.insertAdjacentHTML('afterbegin',
    `<p style="padding:16px;color:#f05d5d">No se pudieron cargar los datos (${err.message}). Sirve la carpeta con <code>python3 -m http.server</code>; no abras el archivo directamente.</p>`);
});

function statsDe(row) {
  if (!row) return { diff: 0, pct: null, z: 0 };
  const a = row.antes, d = row.despues, Ex = a * ratioCiudad;
  return { diff: d - Ex, pct: Ex > 0 ? (d / Ex - 1) * 100 : null, z: Ex > 0 ? (d - Ex) / Math.sqrt(Ex) : 0 };
}
function clsDe(row) {
  const z = statsDe(row).z;
  return z <= -1.96 ? 'neg' : z >= 1.96 ? 'pos' : 'mid';
}
function corredorDeTramo(f) {
  const ids = (f.properties.sitios || '').split(';').filter(Boolean);
  for (const id of ids) { const s = sitioById.get(id); if (s) return s.corredor; }
  return null;
}

function drawHero() {
  const cv = document.getElementById('heroRoads'), box = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  cv.width = box.width * dpr; cv.height = box.height * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  const w = box.width, h = box.height, left = w > 820 ? w * 0.5 : 0;
  const pj = d3.geoMercator().fitExtent([[left, 20], [w - 20, h - 20]], DATA.tramos);
  const p = d3.geoPath(pj, ctx);
  ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round';
  DATA.tramos.features.forEach(f => {
    ctx.beginPath(); p(f);
    if (f.properties.con_camara) { ctx.strokeStyle = C('--acc'); ctx.globalAlpha = .9; ctx.lineWidth = 1.8 + f.properties.camaras_km * 3; }
    else { ctx.strokeStyle = C('--road2'); ctx.globalAlpha = 1; ctx.lineWidth = 1; }
    ctx.stroke();
  });
  DATA.sitios.forEach(s => { const [x, y] = pj([s.lon, s.lat]); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, 7); ctx.fillStyle = '#fff'; ctx.strokeStyle = C('--ink'); ctx.lineWidth = 1.4; ctx.fill(); ctx.stroke(); });

  const ciudadCambio = (DATA.tendencia.CONTROL.at(-1).indice - 100);
  const muertos = DATA.efecto['CON MUERTOS'];
  const tiles = [
    { big: fmt((DATA.efecto.TODAS.razon_tasa - 1) * 100) + ' %', cls: DATA.efecto.TODAS.razon_tasa < 1 ? 'neg' : 'pos', d: 'siniestros en corredores con cámara' },
    { big: fmt(ciudadCambio) + ' %', cls: 'mid', d: 'en corredores sin cámara, mismo periodo' },
    { big: fmt((muertos.razon_tasa - 1) * 100) + ' %', cls: muertos.razon_tasa < 1 ? 'neg' : 'pos', d: 'siniestros con muertos cerca de las cámaras' }
  ];
  d3.select('#heroStats').selectAll('div').data(tiles).join('div').html(d => `<span class="big ${d.cls}">${d.big}</span><span>${d.d}</span>`);
}

function createMap(svgId, opt) {
  const W = opt.W || 700, H = opt.H || 820;
  const svg = d3.select(svgId).attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
  const FB = opt.fitBox || [[40, 30], [W - 40, H - 30]];
  const proj = d3.geoMercator().fitExtent(FB, DATA.tramos);
  const path = d3.geoPath(proj);
  svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent');
  const gZoom = svg.append('g');
  const gRoads = gZoom.append('g'), gCam = gZoom.append('g'), gDots = gZoom.append('g');
  let T = d3.zoomIdentity, st = {};
  const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[-300, -300], [W + 300, H + 300]])
    .on('zoom', ev => { T = ev.transform; gZoom.attr('transform', T); });
  if (opt.interactive) svg.call(zoom).on('dblclick.zoom', null); else svg.call(zoom).on('.zoom', null);

  gRoads.selectAll('path').data(DATA.tramos.features.filter(f => !f.properties.con_camara)).join('path')
    .attr('d', path).attr('fill', 'none').attr('stroke', C('--road2')).attr('stroke-width', 1.1).attr('vector-effect', 'non-scaling-stroke');

  const camF = DATA.tramos.features.filter(f => f.properties.con_camara).sort((a, b) => a.properties.camaras_km - b.properties.camaras_km);
  const camSel = gCam.selectAll('path').data(camF).join('path').attr('d', path).attr('fill', 'none')
    .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke')
    .on('mousemove', (ev, d) => { if (st.lay === 'dens') tipShow(`<b>Tramo ${d.properties.tid}</b><br>${pretty(d.properties.via)} entre ${pretty(d.properties.entre)}<br><b>${nf(d.properties.camaras_km, 2)} cámaras por km</b>`, ev); })
    .on('mouseleave', tipHide);

  const qCol = k => k < 0.25 ? C('--acc3') : k < 0.6 ? C('--acc2') : C('--acc');
  const rad = d3.scaleSqrt().domain([0, maxDiff]).range([3.5, 16]);

  function render(next, animate = true) {
    st = Object.assign({ lay: 'sin', corr: '' }, next);
    const D = dur(animate ? 600 : 0);
    camSel.transition().duration(D)
      .attr('stroke', d => st.lay === 'dens' ? qCol(d.properties.camaras_km) : (st.corr && corredorDeTramo(d) === st.corr) ? C('--acc') : C('--acc3'))
      .attr('stroke-width', d => st.lay === 'dens' ? 2 + d.properties.camaras_km * 6 : (st.corr && corredorDeTramo(d) === st.corr) ? 3.2 : 2)
      .attr('opacity', d => !st.corr || corredorDeTramo(d) === st.corr ? 1 : 0.25);
    drawDots(D);
    if (opt.onRender) opt.onRender(st);
  }

  function pass(s) { return !st.corr || s.corredor === st.corr; }

  function drawDots(D) {
    const sin = st.lay === 'sin';
    const data = DATA.sitios.slice().sort((a, b) => Math.abs(statsDe(rankByCorredor.get(b.corredor)).diff) - Math.abs(statsDe(rankByCorredor.get(a.corredor)).diff));
    const c = gDots.selectAll('circle').data(data, d => d.sitio).join(e => e.append('circle').attr('r', 0))
      .style('cursor', opt.interactive ? 'pointer' : null)
      .attr('cx', d => proj([d.lon, d.lat])[0]).attr('cy', d => proj([d.lon, d.lat])[1])
      .on('mousemove', (ev, d) => { if (pass(d)) tipShow(sitioHTML(d), ev); })
      .on('mouseleave', tipHide)
      .on('click', (ev, d) => { if (opt.onClickSite) opt.onClickSite(d); });
    c.transition().duration(D)
      .attr('r', d => !pass(d) ? 2.5 : sin ? rad(Math.abs(statsDe(rankByCorredor.get(d.corredor)).diff)) : 4.5)
      .attr('fill', d => !pass(d) ? C('--road2') : sin ? C('--' + clsDe(rankByCorredor.get(d.corredor))) : '#fff')
      .attr('stroke', d => !pass(d) ? 'none' : sin ? '#fff' : C('--ink'))
      .attr('stroke-width', d => sin ? 1.5 : 1.6)
      .attr('fill-opacity', d => sin && clsDe(rankByCorredor.get(d.corredor)) === 'mid' ? 0.85 : 1);
  }

  function sitioHTML(s) {
    const row = rankByCorredor.get(s.corredor), S = statsDe(row);
    const verdict = !row ? '<span style="color:var(--muted)">Sin datos de corredor</span>'
      : clsDe(row) === 'neg' ? '<span style="color:var(--neg)">Disminuyó más de lo esperado</span>'
      : clsDe(row) === 'pos' ? '<span style="color:var(--pos)">Aumentó más de lo esperado</span>'
      : '<span style="color:var(--muted)">Sin cambio significativo</span>';
    return `<b style="font-size:15px">${pretty(s.corredor)}</b><br><b>${verdict}</b><br>` +
      (row ? `siniestros: antes <b>${nf(row.antes, 0)}</b> · después <b>${nf(row.despues, 0)}</b><br>` : '') +
      `<span style="opacity:.65">${s.n_camaras} cámara${s.n_camaras > 1 ? 's' : ''} · desde ${s.fecha_activacion || '—'}</span>`;
  }

  return {
    render, sitioHTML,
    zoomBy: k => svg.transition().duration(dur(300)).call(zoom.scaleBy, k)
  };
}

function initStory() {
  const wide = innerWidth > 820;
  const map = wide ? createMap('#storyMap', { interactive: false, W: 1200, H: 800, fitBox: [[470, 40], [1160, 760]] })
                   : createMap('#storyMap', { interactive: false, W: 700, H: 760 });
  const leg = d3.select('#storyLegend');
  const L = {
    base: '<span><i class="l" style="background:var(--acc)"></i>Tramo con cámara</span><span><i class="c" style="border:1.6px solid var(--ink)"></i>Cruce con cámaras</span>',
    sin: '<span><i class="c" style="background:var(--neg)"></i>Disminuyó más de lo esperado</span><span><i class="c" style="background:var(--mid)"></i>Sin cambio significativo</span><span><i class="c" style="background:var(--pos)"></i>Aumentó más de lo esperado</span>'
  };
  const top = DATA.ranking.filter(r => r.cambio_pct !== null).sort((a, b) => a.cambio_pct - b.cambio_pct).slice(0, 3);
  d3.select('#topCorredores').text(top.map(r => pretty(r.corredor)).join(', '));
  const reduccion = (DATA.efecto.TODAS.razon_tasa - 1) * 100;
  d3.select('#efectoTexto').text(fmt(reduccion) + ' %');
  const scenes = [[{ lay: 'base' }, L.base], [{ lay: 'base' }, L.base], [{ lay: 'dens' }, L.base], [{ lay: 'sin' }, L.sin], [{ lay: 'sin' }, L.sin]];
  let cur = -1;
  const go = i => { if (i === cur) return; cur = i; map.render(scenes[i][0], true); leg.html(scenes[i][1]); };
  map.render(scenes[0][0], false); leg.html(scenes[0][1]);
  const steps = d3.selectAll('.step');
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { steps.classed('on', false); d3.select(e.target).classed('on', true); go(+e.target.dataset.scene); } });
  }, { rootMargin: '-45% 0px -45% 0px' });
  steps.each(function () { io.observe(this); });
}

const E = { lay: 'sin', corr: '' };
let EX;
function initExplorer() {
  EX = createMap('#expMap', {
    interactive: true, W: 700, H: 820,
    onClickSite: d => { E.corr = E.corr === d.corredor ? '' : d.corredor; d3.select('#fcorr').property('value', E.corr); updateExplorer(); },
    onRender: () => { drawRank(); drawSide(); drawSummary(); updateFilterUI(); }
  });
  d3.select('#flay').selectAll('button').data([['sin', 'Siniestros por corredor'], ['dens', 'Cámaras por km de tramo']]).join('button')
    .attr('type', 'button').attr('role', 'tab').text(d => d[1]).attr('aria-selected', d => d[0] === E.lay)
    .on('click', (ev, d) => { E.lay = d[0]; d3.select('#flay').selectAll('button').attr('aria-selected', o => o[0] === E.lay); updateExplorer(); });
  const corrs = [...new Set(DATA.sitios.map(s => s.corredor))].sort();
  d3.select('#fcorr').selectAll('option').data([''].concat(corrs)).join('option').attr('value', d => d).text(d => d ? pretty(d) : 'Toda la ciudad');
  d3.select('#fcorr').on('change', function () { E.corr = this.value; updateExplorer(); });
  d3.select('#fclear').on('click', () => { E.corr = ''; d3.select('#fcorr').property('value', ''); updateExplorer(); });
  d3.select('#zin').on('click', () => EX.zoomBy(1.6));
  d3.select('#zout').on('click', () => EX.zoomBy(1 / 1.6));
  d3.select('#zreset').on('click', () => { E.corr = ''; d3.select('#fcorr').property('value', ''); updateExplorer(); });
  updateExplorer(false);
}
function updateFilterUI() {
  d3.select('#fclear').property('hidden', !E.corr);
}
function updateExplorer(animate = true) {
  d3.select('#expLegend').html(E.lay === 'dens'
    ? '<div class="lg-g"><span class="lg-k">Cámaras por km</span><span><i class="l" style="background:var(--acc3)"></i>menos de 0,25</span><span><i class="l" style="background:var(--acc2);height:5px"></i>0,25 a 0,6</span><span><i class="l" style="background:var(--acc);height:7px"></i>más de 0,6</span></div>'
    : '<div class="lg-g"><span class="lg-k">Color</span><span><i class="c" style="background:var(--neg)"></i>Disminuyó</span><span><i class="c" style="background:var(--mid)"></i>Sin cambio</span><span><i class="c" style="background:var(--pos)"></i>Aumentó</span></div>');
  EX.render(Object.assign({}, E), animate);
}
function drawRank() {
  const svg = d3.select('#rank');
  d3.select('#sideT').text(E.lay === 'sin' ? 'Significancia del cambio' : 'Tramos por cámaras/km');
  d3.select('#sideSub').property('hidden', E.lay !== 'sin');
  svg.style('display', E.lay === 'sin' ? null : 'none'); if (E.lay !== 'sin') return;
  const pts = DATA.ranking.map(r => ({ r, a: r.antes, st: statsDe(r) })).filter(p => p.a > 0 && p.st.pct != null);
  const Wr = 460, m = { l: 46, r: 14, t: 10, b: 40 }, Hr = 320;
  svg.attr('viewBox', `0 0 ${Wr} ${Hr}`); svg.selectAll('*').remove();
  const xmax = d3.max(pts, p => p.a) * 1.08;
  const x = d3.scaleLinear().domain([0, xmax]).range([m.l, Wr - m.r]);
  const y = d3.scaleLinear().domain([-100, 150]).range([Hr - m.b, m.t]).clamp(true);
  const lim = a => 1.96 / Math.sqrt(2 * a * ratioCiudad) * 100;
  const xs = d3.range(xmax * 0.02, xmax, xmax / 120);
  svg.append('path').attr('fill', C('--bg2')).attr('d', d3.area().x(a => x(a)).y0(a => y(-lim(a))).y1(a => y(lim(a))).curve(d3.curveBasis)(xs));
  svg.append('g').attr('transform', `translate(${m.l},0)`)
    .call(d3.axisLeft(y).tickValues([-100, -50, 0, 50, 100, 150]).tickSize(-(Wr - m.l - m.r)).tickFormat(v => (v > 0 ? '+' : '') + v + '%'))
    .call(g => g.select('.domain').remove()).call(g => g.selectAll('.tick line').attr('stroke', v => v === 0 ? C('--muted') : C('--line')))
    .selectAll('text').attr('class', 'ax');
  svg.append('g').attr('transform', `translate(0,${Hr - m.b})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8))
    .call(g => g.select('.domain').remove()).selectAll('text').attr('class', 'ax');
  svg.append('text').attr('class', 'ax').attr('x', Wr - m.r).attr('y', Hr - 6).attr('text-anchor', 'end').text('siniestros antes de las cámaras →');
  const g = svg.append('g');
  g.selectAll('circle').data(pts.sort((p, q) => Math.abs(q.st.diff) - Math.abs(p.st.diff)), p => p.r.corredor).join('circle')
    .attr('cx', p => x(p.a)).attr('cy', p => y(p.st.pct)).attr('r', 6.5)
    .attr('fill', p => C('--' + clsDe(p.r))).attr('stroke', '#fff').attr('stroke-width', 1.5)
    .attr('opacity', p => !E.corr || p.r.corredor === E.corr ? 1 : 0.2).style('cursor', 'pointer')
    .on('mousemove', (ev, p) => tipShow(`<b style="font-size:15px">${pretty(p.r.corredor)}</b><br>siniestros: antes <b>${nf(p.r.antes, 0)}</b> · después <b>${nf(p.r.despues, 0)}</b><br>cambio frente a lo esperado: <b>${fmt(p.st.pct)} %</b>`, ev))
    .on('mouseleave', tipHide)
    .on('click', (ev, p) => { E.corr = E.corr === p.r.corredor ? '' : p.r.corredor; d3.select('#fcorr').property('value', E.corr); updateExplorer(); });
  pts.filter(p => clsDe(p.r) !== 'mid').forEach(p => {
    g.append('text').attr('class', 'ax halo').attr('x', x(p.a) + 10).attr('y', y(p.st.pct) + 4).text(pretty(p.r.corredor));
  });
}
function drawSide() {
  const side = d3.select('#side').property('hidden', E.lay === 'sin'); if (E.lay === 'sin') return;
  const rows = DATA.tramos.features.filter(f => f.properties.con_camara && (!E.corr || corredorDeTramo(f) === E.corr))
    .map(f => f.properties).sort((a, b) => b.camaras_km - a.camaras_km);
  side.html('<div class="tw"><table><tr><th>Tramo</th><th>Vía</th><th>Cám./km</th></tr>' +
    rows.map(p => `<tr><td>${p.tid}</td><td>${pretty(p.via)}</td><td>${nf(p.camaras_km, 2)}</td></tr>`).join('') + '</table></div>');
}
function drawSummary() {
  const el = d3.select('#fsum');
  if (E.lay !== 'sin') { el.html('Las avenidas más brillantes tienen más cámaras por kilómetro: ahí es donde la cámara pesa más en la velocidad del tramo.'); return; }
  const rows = E.corr ? DATA.ranking.filter(r => r.corredor === E.corr) : DATA.ranking;
  if (!rows.length) { el.text('Este corredor no tiene suficiente coincidencia de texto para calcular un cambio.'); return; }
  const a = d3.sum(rows, r => r.antes), d = d3.sum(rows, r => r.despues);
  el.html(`<b>${rows.length}</b> corredor${rows.length > 1 ? 'es' : ''} con dato · siniestros de <b>${nf(a, 0)}</b> a <b>${nf(d, 0)}</b> (${fmt((d / a - 1) * 100)} %). Resto de la ciudad: ${fmt((ratioCiudad - 1) * 100)} %.`);
}

function drawTrend() {
  const svg = d3.select('#idx'), Wd = 1100, Hd = 420, m = { l: 46, r: 220, t: 30, b: 34 };
  svg.attr('viewBox', `0 0 ${Wd} ${Hd}`); svg.selectAll('*').remove();
  const trat = DATA.tendencia.TRATAMIENTO, ctrl = DATA.tendencia.CONTROL, yrs = trat.map(d => d.anio);
  const all = trat.concat(ctrl).map(d => d.indice);
  const x = d3.scalePoint().domain(yrs).range([m.l, Wd - m.r]);
  const y = d3.scaleLinear().domain([Math.floor((d3.min(all) - 8) / 20) * 20, Math.ceil((d3.max(all) + 8) / 20) * 20]).range([Hd - m.b, m.t]);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(Wd - m.l - m.r)))
    .call(a => a.select('.domain').remove())
    .call(a => a.selectAll('.tick line').attr('stroke', d => d === 100 ? C('--muted') : C('--line')).attr('stroke-dasharray', d => d === 100 ? '3 4' : null))
    .selectAll('text').attr('class', 'ax');
  svg.append('g').attr('transform', `translate(0,${Hd - m.b})`).call(d3.axisBottom(x).tickSize(0).tickPadding(12))
    .call(a => a.select('.domain').remove()).selectAll('text').attr('class', 'ax');
  const line = d3.line().x(d => x(d.anio)).y(d => y(d.indice)).curve(d3.curveMonotoneX);
  [[ctrl, C('--ctrl'), 'Sin cámara', 2], [trat, C('--neg'), 'Con cámara', 3]].forEach(([serie, col, nombre, w]) => {
    svg.append('path').datum(serie).attr('fill', 'none').attr('stroke', col).attr('stroke-width', w).attr('d', line);
    svg.append('g').selectAll('circle').data(serie).join('circle').attr('cx', d => x(d.anio)).attr('cy', d => y(d.indice))
      .attr('r', 4.5).attr('fill', col).attr('stroke', '#fff').attr('stroke-width', 2)
      .on('mousemove', (ev, d) => tipShow(`<b>${nombre}, ${d.anio}</b><br>índice ${nf(d.indice)} (n=${nf(d.n, 0)})`, ev)).on('mouseleave', tipHide);
    const last = serie.at(-1);
    svg.append('text').attr('class', 'annb').attr('x', x(last.anio) + 14).attr('y', y(last.indice) + 5).style('fill', col)
      .text(`${nombre} ${fmt(last.indice - 100)} %`);
  });
}

function drawEffect() {
  const svg = d3.select('#efecto'), Wd = 1100, rowH = 40, m = { l: 210, r: 40, t: 40, b: 40 };
  const groups = [['TODAS', 'Todos los siniestros'], ['CON HERIDOS', 'Con heridos'], ['CON MUERTOS', 'Con muertos'], ['SOLO DANOS', 'Solo daños']];
  const Hd = m.t + groups.length * rowH + m.b;
  svg.attr('viewBox', `0 0 ${Wd} ${Hd}`); svg.selectAll('*').remove();
  const x = d3.scaleLinear().domain([-60, 40]).range([m.l, Wd - m.r]).clamp(true);
  svg.append('g').attr('transform', `translate(0,${m.t - 10})`).call(d3.axisTop(x).tickValues([-60, -40, -20, 0, 20, 40]).tickSize(-(Hd - m.t - m.b + 10)).tickFormat(v => (v > 0 ? '+' : '') + v + ' %'))
    .call(g => g.select('.domain').remove()).call(g => g.selectAll('.tick line').attr('stroke', v => v === 0 ? C('--ink2') : C('--line')))
    .selectAll('text').attr('class', 'ax');
  svg.append('text').attr('class', 'ann').attr('x', x(-58)).attr('y', Hd - 12).text('← disminuyó');
  svg.append('text').attr('class', 'ann').attr('x', x(38)).attr('y', Hd - 12).attr('text-anchor', 'end').text('aumentó →');
  groups.forEach(([k, name], i) => {
    const row = DATA.efecto[k]; if (!row) return;
    const yy = m.t + i * rowH + rowH / 2, efectoPct = (row.razon_tasa - 1) * 100, lo = (row.ci95_bajo - 1) * 100, hi = (row.ci95_alto - 1) * 100;
    const sig = hi < 0 || lo > 0, col = sig ? (efectoPct < 0 ? C('--neg') : C('--pos')) : C('--ink2');
    svg.append('text').attr('class', 'annb').attr('x', 0).attr('y', yy + 4).text(name);
    svg.append('line').attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', yy).attr('y2', yy).attr('stroke', col).attr('stroke-width', 2.5);
    svg.append('circle').attr('cx', x(efectoPct)).attr('cy', yy).attr('r', 7).attr('fill', col).attr('stroke', '#fff').attr('stroke-width', 2)
      .on('mousemove', ev => tipShow(`<b>${name}</b><br>Efecto estimado: <b>${fmt(efectoPct)} %</b><br>Intervalo 95 %: ${fmt(lo)} % a ${fmt(hi)} %<br>${sig ? 'Significativo' : 'No significativo: el intervalo incluye el 0'}`, ev))
      .on('mouseleave', tipHide);
    svg.append('text').attr('class', 'labb').attr('x', x(Math.min(hi, 40)) + 14).attr('y', yy + 5).text(fmt(efectoPct) + ' %');
  });
}

function drawDose() {
  const feats = DATA.tramos.features;
  const byTid = new Map(feats.map(f => [f.properties.tid, f.properties]));
  const pts = DATA.exposicion.map(e => Object.assign({}, e, byTid.get(e.tid))).filter(p => p.distancia_m > 0);
  pts.forEach(p => { p.ckm = p.n_camaras / (p.distancia_m / 1000); });
  const control = pts.filter(p => !p.con_camara).map(p => p.delta_p85).sort(d3.ascending);
  const q1 = d3.quantile(control, 0.25), q3 = d3.quantile(control, 0.75), med = d3.quantile(control, 0.5);
  const treat = pts.filter(p => p.con_camara);
  const svg = d3.select('#dose'), Wd = 1100, Hd = 460, m = { l: 52, r: 30, t: 34, b: 48 };
  svg.attr('viewBox', `0 0 ${Wd} ${Hd}`); svg.selectAll('*').remove();
  const xmax = d3.max(treat, p => p.ckm) * 1.1 || 1.5;
  const x = d3.scaleLinear().domain([0, xmax]).range([m.l, Wd - m.r]);
  const ymax = d3.max(pts, p => Math.abs(p.delta_p85)) * 1.15 || 10;
  const y = d3.scaleLinear().domain([-ymax, ymax]).range([Hd - m.b, m.t]).clamp(true);
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickFormat(v => (v > 0 ? '+' : '') + v))
    .call(a => a.select('.domain').remove()).call(a => a.selectAll('.tick line').attr('stroke', v => v === 0 ? C('--muted') : C('--line')))
    .selectAll('text').attr('class', 'ax');
  svg.append('g').attr('transform', `translate(0,${Hd - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickPadding(12))
    .call(a => a.select('.domain').remove()).selectAll('text').attr('class', 'ax');
  svg.append('text').attr('class', 'ax').attr('x', m.l).attr('y', 14).text('Cambio de velocidad p85, km/h');
  svg.append('text').attr('class', 'ax').attr('x', Wd - m.r).attr('y', Hd - 6).attr('text-anchor', 'end').text('cámaras por km del tramo →');
  svg.append('rect').attr('x', m.l).attr('width', Wd - m.l - m.r).attr('y', y(q3)).attr('height', y(q1) - y(q3)).attr('fill', C('--band'));
  svg.append('line').attr('x1', m.l).attr('x2', Wd - m.r).attr('y1', y(med)).attr('y2', y(med)).attr('stroke', C('--ctrl')).attr('stroke-dasharray', '4 4');
  svg.append('text').attr('class', 'ann').attr('x', Wd - m.r).attr('y', 14).attr('text-anchor', 'end').text(`Franja gris: mitad de los tramos sin cámara cambió entre ${fmt(q1)} y ${fmt(q3)} km/h`);
  svg.selectAll('circle').data(treat, p => p.tid).join('circle')
    .attr('cx', p => x(p.ckm)).attr('cy', p => y(p.delta_p85)).attr('r', p => 5 + p.n_camaras * 0.6)
    .attr('fill', p => p.ckm >= 0.5 ? C('--acc') : C('--acc2')).attr('stroke', '#fff').attr('stroke-width', 2)
    .on('mousemove', (ev, p) => tipShow(`<b>tramo ${p.tid}</b> · ${pretty(p.via)}<br>${nf(p.n_camaras, 0)} cámaras · ${nf(p.ckm, 2)} por km<br>p85 antes: ${nf(p.p85_antes)} km/h<br><b>Cambio: ${fmt(p.delta_p85)} km/h</b>`, ev))
    .on('mouseleave', tipHide);
  const worst = treat.length ? treat.reduce((a, b) => a.delta_p85 < b.delta_p85 ? a : b) : null;
  d3.select('#doseNote').text(worst ? `El tramo con mayor caída de velocidad es el ${worst.tid} (${fmt(worst.delta_p85)} km/h), con ${nf(worst.ckm, 2)} cámaras por km. Son ${treat.length} tramos con cámara: es una pista, no una prueba.` : '');
}

function drawHeat() {
  const H = DATA.heat, yrs = [...new Set(H.map(d => d.anio))].sort((a, b) => a - b);
  const byCorr = d3.group(H, d => d.corredor);
  const rows = [...byCorr.entries()].map(([corredor, arr]) => {
    const v = yrs.map(y => (arr.find(d => d.anio === y) || { n: 0 }).n);
    return { corredor, v, tot: d3.sum(v) };
  }).sort((a, b) => b.tot - a.tot);
  const wide = (document.getElementById('heat').clientWidth || 1100) > 700;
  const rh = 26, cw = wide ? 74 : 46, L = wide ? 220 : 150, top = 70, Rb = wide ? 160 : 80;
  const Wd = L + yrs.length * cw + 16 + Rb, Hd = top + rows.length * rh + 24;
  const svg = d3.select('#heat').attr('viewBox', `0 0 ${Wd} ${Hd}`); svg.selectAll('*').remove();
  const mx = d3.max(rows, r => d3.max(r.v)) || 1;
  const col = d3.scaleSequential(t => d3.interpolateRgb('#f3effd', '#4b1fb8')(t)).domain([0, mx]);
  const x = i => L + i * cw;
  const tots = yrs.map((y, i) => d3.sum(rows, r => r.v[i])), ty = d3.scaleLinear().domain([0, d3.max(tots)]).range([0, 36]);
  tots.forEach((t, i) => {
    svg.append('rect').attr('x', x(i) + 8).attr('width', cw - 16).attr('y', top - 22 - ty(t)).attr('height', ty(t)).attr('fill', C('--acc2'));
    svg.append('text').attr('class', 'ax').attr('x', x(i) + cw / 2).attr('y', top - 26 - ty(t)).attr('text-anchor', 'middle').text(t);
    svg.append('text').attr('class', 'labb').attr('x', x(i) + cw / 2).attr('y', top - 6).attr('text-anchor', 'middle').text(yrs[i]);
  });
  const tr = d3.scaleLinear().domain([0, d3.max(rows, r => r.tot)]).range([0, Rb - 44]);
  const g = svg.append('g');
  rows.forEach((r, k) => {
    const y = top + k * rh, row = g.append('g').style('cursor', 'pointer');
    row.append('text').attr('class', 'lab').attr('x', L - 10).attr('y', y + rh / 2 + 4).attr('text-anchor', 'end').text(pretty(r.corredor));
    r.v.forEach((v, i) => {
      row.append('rect').attr('x', x(i) + 1).attr('y', y + 1).attr('width', cw - 2).attr('height', rh - 2).attr('fill', col(v));
      row.append('text').attr('x', x(i) + cw / 2).attr('y', y + rh / 2 + 4).attr('text-anchor', 'middle')
        .style('font', '600 12px var(--f-body)').style('fill', v > mx * 0.55 ? '#fff' : C('--ink2')).text(v);
    });
    row.append('rect').attr('x', x(yrs.length) + 16).attr('y', y + 4).attr('width', tr(r.tot)).attr('height', rh - 8).attr('fill', C('--acc2'));
    row.append('text').attr('class', 'ax').attr('x', x(yrs.length) + 20 + tr(r.tot)).attr('y', y + rh / 2 + 4).text(r.tot);
    row.append('rect').attr('x', 0).attr('y', y).attr('width', Wd).attr('height', rh).attr('fill', 'transparent')
      .on('mousemove', ev => tipShow(`<b>${pretty(r.corredor)}</b><br>${yrs.map((yy, i) => `${yy}: <b>${r.v[i]}</b>`).join(' · ')}`, ev))
      .on('mouseleave', tipHide)
      .on('click', () => { E.corr = r.corredor; d3.select('#fcorr').property('value', E.corr); updateExplorer(); document.getElementById('explorar').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); });
  });
}

function drawVelGrav() {
  const names = { MADRUGADA: 'Madrugada', PICO_MANANA: 'Pico mañana', VALLE: 'Mediodía', PICO_TARDE: 'Pico tarde', NOCHE: 'Noche' };
  const orden = ['MADRUGADA', 'PICO_MANANA', 'VALLE', 'PICO_TARDE', 'NOCHE'];
  const GRAV = [['CON MUERTOS', C('--pos')], ['CON HERIDOS', C('--acc2')], ['SOLO DANOS', C('--acc3')]];
  const byFranja = d3.group(DATA.gravedad, d => d.franja);
  const cell = d3.select('#mult').selectAll('div.cell').data(orden).join(e => {
    const c = e.append('div').attr('class', 'cell');
    c.append('div').attr('class', 't');
    c.append('svg').attr('viewBox', '0 0 200 210').attr('role', 'img');
    return c;
  });
  cell.select('.t').text(f => names[f]);
  cell.each(function (franja) {
    const bins = byFranja.get(franja) || [];
    const svg = d3.select(this).select('svg'), B = 178, T = 20;
    const mx = d3.max(bins, b => b.pct) * 1.2 || 60;
    const y = d3.scaleLinear().domain([0, mx]).range([B, T]);
    const x = d3.scaleBand().domain(GRAV.map(g => g[0])).range([28, 198]).padding(0.16);
    svg.selectAll('g.y').data([0]).join('g').attr('class', 'y').attr('transform', 'translate(24,0)')
      .call(d3.axisLeft(y).ticks(3).tickSize(-174).tickFormat(t => Math.round(t) + '%'))
      .call(a => a.select('.domain').remove()).call(a => a.selectAll('.tick line').attr('stroke', C('--line')))
      .selectAll('text').attr('class', 'ax');
    svg.selectAll('rect.bar').data(GRAV, g => g[0]).join(e => e.append('rect').attr('class', 'bar').attr('y', B).attr('height', 0))
      .attr('x', g => x(g[0])).attr('width', x.bandwidth()).attr('fill', g => g[1])
      .on('mousemove', (ev, g) => { const b = bins.find(b => b.gravedad === g[0]); tipShow(`<b>${names[franja]} · ${g[0].toLowerCase()}</b><br>${b ? nf(b.n, 0) + ' siniestros · ' + nf(b.pct, 1) + ' %' : 'sin datos'}`, ev); })
      .on('mouseleave', tipHide)
      .transition().duration(dur(500)).attr('y', g => { const b = bins.find(b => b.gravedad === g[0]); return y(b ? b.pct : 0); })
      .attr('height', g => { const b = bins.find(b => b.gravedad === g[0]); return B - y(b ? b.pct : 0); });
    svg.selectAll('text.val').data(GRAV, g => g[0]).join('text').attr('class', 'labb val').attr('text-anchor', 'middle')
      .attr('x', g => x(g[0]) + x.bandwidth() / 2)
      .text(g => { const b = bins.find(b => b.gravedad === g[0]); return b ? nf(b.pct, 1) : ''; })
      .transition().duration(dur(500)).attr('y', g => { const b = bins.find(b => b.gravedad === g[0]); return y(b ? b.pct : 0) - 6; });
    svg.selectAll('text.xl').data(GRAV, g => g[0]).join('text').attr('class', 'ax xl').attr('text-anchor', 'middle')
      .attr('x', g => x(g[0]) + x.bandwidth() / 2).attr('y', B + 18).text(g => g[0] === 'CON MUERTOS' ? 'Muertos' : g[0] === 'CON HERIDOS' ? 'Heridos' : 'Solo daños');
  });
}

})();

/* Página «Del resultado al mecanismo» (mecanismo.html).
   Independiente de app.js: su propia IIFE, sus propios datos y helpers locales. */
(function () {
  'use strict';
  const root = document.getElementById('mecanismo');
  if (!root || typeof d3 === 'undefined') return;

  // ---------- Helpers locales (mismo comportamiento que los de app.js) ----------
  const C = t => getComputedStyle(document.documentElement).getPropertyValue(t).trim();
  const loc = d3.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['$', ''], minus: '−' });
  const nf = (v, d = 0) => (v == null || !isFinite(v)) ? '—' : loc.format(`,.${d}f`)(v);
  const fmt = (v, d = 0) => {
    if (v == null || !isFinite(v)) return '—';
    const r = +(+v).toFixed(d);
    return (r > 0 ? '+' : r < 0 ? '−' : '') + nf(Math.abs(r), d);
  };
  const pct = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : nf(v, d) + ' %';
  const pretty = s => (s || '').trim();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = ms => (reduce ? 0 : ms);
  const esMovil = () => matchMedia('(max-width: 820px)').matches;

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

  function seg(sel, options, get, set) {
    const box = d3.select(sel);
    box.selectAll('button').data(options).join('button').attr('type', 'button')
      .text(d => d[1]).attr('aria-pressed', d => d[0] === get())
      .on('click', (ev, d) => { set(d[0]); box.selectAll('button').attr('aria-pressed', o => o[0] === get()); });
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function fmtFecha(f) {
    if (!f) return '—';
    const d = new Date(f + 'T00:00:00');
    return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
  }
  function fmtMes(f) {
    const d = new Date(f + 'T00:00:00');
    return `${MESES[d.getMonth()]}. ${d.getFullYear()}`;
  }

  // ---------- Carga ----------
  Promise.all([
    d3.json('data/sitios_mecanismo.json'),
    d3.json('data/tramos.geojson'),
    d3.json('data/exposicion_camaras.json'),
    d3.json('data/actores_mecanismo.json').catch(() => null),   // opcional (escena 6)
    d3.json('data/calidad_geocod.json').catch(() => null)       // opcional (nota)
  ]).then(([mec, tramos, expo, actores, geo]) => {
    init(mec, tramos, expo, actores, geo);
  }).catch(err => {
    console.error('[mecanismo]', err);
    d3.select('#mecNota').text(`No se pudieron cargar los datos de esta página (${err.message}). Si abriste el archivo directamente, sirve la carpeta con python -m http.server.`);
  });

  // ---------- Constantes de dibujo ----------
  const W = 720, H = 640;
  const FRANJAS = [['MADRUGADA', 'Madrugada'], ['PICO_MANANA', 'Pico mañana'], ['VALLE', 'Mediodía'], ['PICO_TARDE', 'Pico tarde'], ['NOCHE', 'Noche']];
  const CAT_LABEL = { PEATON: 'Peatón', MOTOCICLISTA: 'Motociclista', CICLISTA: 'Ciclista', PASAJERO: 'Pasajero', CONDUCTOR: 'Conductor' };
  const DESTACADAS = ['PEATON', 'MOTOCICLISTA'];

  function init(mec, tramos, expo, actores, geo) {
    const meta = mec.meta, res = meta.resumen || {}, ctrl = mec.control;
    const [uS1, uS2, uS3, uS4] = meta.umbrales_siniestros_pct;
    const [uV1, uV2, uV3] = meta.umbrales_velocidad_kmh;
    const COL = {
      baja_fuerte: C('--mec-baja-fuerte'), baja: C('--mec-baja'), igual: C('--mec-igual'),
      sube: C('--mec-sube'), sube_fuerte: C('--mec-sube-fuerte'), borde: C('--mec-borde'),
      franja: C('--mec-franja'), fondo: C('--bg'), road: C('--road2'), ctrl: C('--ctrl'),
      acc: C('--acc'), acc3: C('--acc3'), line: C('--line'), muted: C('--muted'), ink2: C('--ink2')
    };

    // ----- Sitios: posición en el mapa, tamaño y posición en la dispersión -----
    const aniosAntes = (meta.meses_antes || 22) / 12;
    const sitios = mec.sitios.slice();
    const proj = d3.geoMercator().fitExtent([[30, 24], [W - 30, H - 24]], tramos);
    const path = d3.geoPath(proj);
    const rS = d3.scaleSqrt().domain([0, d3.max(sitios, s => s.graves_antes / aniosAntes) || 1]).range([4, 12]);
    sitios.forEach(s => {
      [s._mx, s._my] = proj([s.lon, s.lat]);
      s._r = rS(s.graves_antes / aniosAntes);
      s._valid = s.tiene_velocidad && !s.pocos_datos && s.cambio_vs_control_pct != null && s.delta_p85_vs_control != null;
    });
    sitios.sort((a, b) => b._r - a._r);   // los grandes abajo, los chicos encima
    const validos = sitios.filter(s => s._valid);

    const M = { l: 66, r: 26, t: 40, b: 62 };
    const xsV = validos.map(s => s.delta_p85_vs_control), ysV = validos.map(s => s.cambio_vs_control_pct);
    const X_TOPE = 12, Y_TOPE = 200;   // valores más allá se dibujan en el borde con flecha
    const sx = d3.scaleLinear()
      .domain([Math.min(-8, (d3.min(xsV) ?? 0) - 1), Math.min(X_TOPE, Math.max(8, (d3.max(xsV) ?? 0) + 1))])
      .nice().range([M.l, W - M.r]);
    const sy = d3.scaleLinear()
      .domain([Math.min(-80, (d3.min(ysV) ?? 0) - 10), Math.min(Y_TOPE, Math.max(80, (d3.max(ysV) ?? 0) + 10))])
      .nice().range([H - M.b, M.t]);
    const [x0, x1] = sx.domain(), [y0, y1] = sy.domain();
    validos.forEach(s => {
      const x = s.delta_p85_vs_control, y = s.cambio_vs_control_pct;
      s._sx = sx(Math.max(x0, Math.min(x1, x)));
      s._sy = sy(Math.max(y0, Math.min(y1, y)));
      s._fuera = x > x1 || x < x0 || y > y1 || y < y0;
    });

    // ----- Cifras para los textos (nada fijo en el HTML) -----
    const empieza = (s, p) => (s || '').startsWith(p);
    const noche = expo.NOCHE || [];
    const medianaDe = arr => arr.length ? d3.median(arr) : null;
    const nBI = validos.filter(s => s.delta_p85_vs_control < 0 && s.cambio_vs_control_pct < 0);
    const r = meta.r_pearson;
    const fuerza = r == null ? '—'
      : (Math.abs(r) < 0.1 ? 'prácticamente nula'
        : (Math.abs(r) < 0.3 ? 'débil' : Math.abs(r) < 0.5 ? 'moderada' : 'fuerte') +
          (r > 0 ? ' y positiva (donde la velocidad subió más, los siniestros tienden a subir un poco más)'
                 : ' y negativa (donde la velocidad subió más, los siniestros tienden a bajar)'));
    const share = (g, p, c) => {
      if (!actores || !actores.grupos[g]) return null;
      const t = d3.sum(Object.values(actores.grupos[g][p]));
      return t ? 100 * actores.grupos[g][p][c] / t : null;
    };
    const V = {
      n_sitios: res.n_sitios ?? sitios.length,
      radio_m: meta.radio_m,
      n_sin_bajan: sitios.filter(s => empieza(s.clase_siniestros, 'baja')).length,
      n_sin_suben: sitios.filter(s => empieza(s.clase_siniestros, 'sube')).length,
      umbral_vel: nf(uV3),
      n_vel_sube: sitios.filter(s => empieza(s.clase_velocidad, 'sube')).length,
      n_vel_baja: sitios.filter(s => empieza(s.clase_velocidad, 'baja')).length,
      n_con_velocidad: res.n_con_velocidad ?? sitios.filter(s => s.tiene_velocidad).length,
      n_bajan_ambos: sitios.filter(s => s.coincide === 'bajan_ambos').length,
      n_suben_ambos: sitios.filter(s => s.coincide === 'suben_ambos').length,
      n_con_ambos: validos.length,
      n_cuadrante_bi: nBI.length,
      n_bi_vel_clara: nBI.filter(s => s.delta_p85_vs_control <= uV2).length,
      r_pearson: nf(r, 2),
      n_correlacion: meta.n_correlacion,
      n_tramos_distintos: res.n_tramos_distintos ?? '—',
      r_fuerza: fuerza,
      n_tramos_cam: noche.filter(e => e.con_camara).length,
      noche_con: fmt(medianaDe(noche.filter(e => e.con_camara).map(e => e.delta_p85)), 1),
      noche_sin: fmt(medianaDe(noche.filter(e => !e.con_camara).map(e => e.delta_p85)), 1),
      peaton_cerca_antes: pct(share('CERCA', 'antes', 'PEATON')),
      peaton_cerca_despues: pct(share('CERCA', 'despues', 'PEATON')),
      peaton_ctrl_antes: pct(share('CONTROL', 'antes', 'PEATON')),
      peaton_ctrl_despues: pct(share('CONTROL', 'despues', 'PEATON')),
      moto_cerca_antes: pct(share('CERCA', 'antes', 'MOTOCICLISTA')),
      moto_cerca_despues: pct(share('CERCA', 'despues', 'MOTOCICLISTA')),
      moto_ctrl_antes: pct(share('CONTROL', 'antes', 'MOTOCICLISTA')),
      moto_ctrl_despues: pct(share('CONTROL', 'despues', 'MOTOCICLISTA'))
    };
    d3.selectAll('[data-mec]').each(function () {
      const v = V[this.dataset.mec];
      this.textContent = v == null ? '—' : v;
    });

    // Escena 6 sin datos: se oculta el paso y se renumeran los demás.
    if (!actores) d3.select('.mec-step[data-mscene="5"]').property('hidden', true);
    const pasosVisibles = d3.selectAll('.mec-step').filter(function () { return !this.hidden; });
    pasosVisibles.select('.mec-n').each(function () { this.textContent = this.textContent.replace(/de \d+/, `de ${pasosVisibles.size()}`); });

    // ----- Nota de fuentes y limitaciones -----
    const errGeo = geo && geo.error_mediano_m ? `${nf(geo.error_mediano_m)} m` : 'unos 170 m';
    d3.select('#mecNota').html(
      `<b>Fuentes:</b> SIGAT (siniestralidad 2018–2022), Cámaras Salvavidas Bogotá y Bitcarrier (velocidad y red vial), Datos Abiertos de Movilidad Bogotá. ` +
      `Siniestros graves = con heridos o con muertos, a ${meta.radio_m} m o menos del sitio; el control es el resto de la ciudad. ` +
      `Antes: ${fmtMes(meta.antes[0])}–${fmtMes(meta.antes[1])}; después: ${fmtMes(meta.despues[0])}–${fmtMes(meta.despues[1])}. Las tasas son por mes porque los dos periodos no duran lo mismo. ` +
      `<br><b>Limitaciones:</b> los siniestros de 2018 a 2021 están geocodificados desde la dirección (error mediano ${errGeo}); por eso se usa un radio de ${meta.radio_m} m. ` +
      `Desde octubre de 2021 casi no hay datos de velocidad en los tramos con cámara, así que el «después» de velocidad es más corto que el de siniestros. ` +
      `2020 se excluye por la cuarentena. ` +
      `Los sitios con menos de ${meta.min_siniestros} siniestros graves se marcan como «pocos datos» y no entran en la correlación (en estos datos: ${nf(res.n_pocos_datos ?? 0)}). ` +
      `Varios sitios comparten el mismo tramo de sensor, así que los ${nf(meta.n_correlacion)} sitios de la correlación tienen solo ${V.n_tramos_distintos} combinaciones de velocidad distintas: es una señal descriptiva, no una prueba causal. ` +
      (actores ? `En la escena 6 el «antes» empieza en 2019 porque el anuario 2018 no separa motociclistas ni ciclistas.` : '')
    );

    // ----- SVG y capas -----
    const svg = d3.select('#mecGraph').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'mecClip').append('rect')
      .attr('x', M.l).attr('y', M.t).attr('width', W - M.l - M.r).attr('height', H - M.t - M.b);
    const gRoads = svg.append('g').attr('class', 'mec-l-roads');
    const gScat = svg.append('g').attr('class', 'mec-l-scat').style('opacity', 0);
    const gBox = svg.append('g').attr('class', 'mec-l-box').style('opacity', 0);
    const gSlope = svg.append('g').attr('class', 'mec-l-slope').style('opacity', 0);
    const gDots = svg.append('g').attr('class', 'mec-l-dots');
    const gScatTop = svg.append('g').attr('class', 'mec-l-scattop').style('opacity', 0);
    const capas = { roads: gRoads, scat: gScat, box: gBox, slope: gSlope, scatTop: gScatTop };

    function mostrar(nombres, D) {
      Object.entries(capas).forEach(([k, g]) => {
        const on = nombres.includes(k);
        g.style('pointer-events', on ? null : 'none').transition('vis').duration(D).style('opacity', on ? 1 : 0);
      });
    }

    // Red vial de fondo (escenas 1-3)
    gRoads.selectAll('path').data(tramos.features).join('path')
      .attr('d', path).attr('fill', 'none').attr('stroke', COL.road).attr('stroke-width', 1.1)
      .attr('vector-effect', 'non-scaling-stroke');

    dibujarEjesDispersion();
    dibujarCajas();
    if (actores) dibujarPendientes();

    // Círculos de los sitios: se crean una vez y cada escena solo cambia atributos.
    const dots = gDots.selectAll('circle').data(sitios, d => d.sitio).join('circle')
      .attr('cx', d => d._mx).attr('cy', d => d._my).attr('r', d => d._r)
      .on('mousemove', (ev, d) => tipShow(htmlSitio(d), ev))
      .on('mouseleave', tipHide);

    function htmlSitio(d) {
      const cambio = d.cambio_vs_control_pct == null ? 'pocos datos' : `<b>${fmt(d.cambio_vs_control_pct)} %</b> frente al control`;
      const vel = d.tiene_velocidad
        ? `<b>${fmt(d.delta_p85_vs_control, 1)} km/h</b> frente al control <span style="opacity:.65">(${nf(d.p85_antes, 1)} → ${nf(d.p85_despues, 1)} km/h)</span>`
        : 'sin sensor cercano';
      return `<b style="font-size:15px">${pretty(d.corredor)}</b> <span style="opacity:.65">· ${d.sitio}</span><br>` +
        `Siniestros graves: antes <b>${nf(d.graves_antes)}</b> · después <b>${nf(d.graves_despues)}</b><br>` +
        `Cambio: ${cambio}<br>` +
        `Velocidad p85 nocturna: ${vel}<br>` +
        `<span style="opacity:.65">${d.n_camaras} cámara${d.n_camaras === 1 ? '' : 's'} · activa desde ${fmtFecha(d.fecha_activacion)}</span>`;
    }

    // ----- Estilo de los círculos según la capa -----
    function estilo(d, capa) {
      const vacio = { fill: COL.fondo, stroke: COL.borde, dash: '2.5 2', op: 1 };
      const lleno = c => ({ fill: COL[c], stroke: c === 'igual' ? COL.borde : COL.fondo, dash: null, op: 1 });
      if (capa === 'sin') return d.clase_siniestros === 'sin_datos' ? vacio : lleno(d.clase_siniestros);
      if (capa === 'vel') return d.clase_velocidad === 'sin_datos' ? vacio : lleno(d.clase_velocidad);
      // 'coi': coincidencia de las dos capas
      if (d.coincide === 'bajan_ambos') return lleno('baja_fuerte');
      if (d.coincide === 'suben_ambos') return lleno('sube_fuerte');
      if (d.coincide === 'sin_datos') return Object.assign({}, vacio, { op: 0.5 });
      return Object.assign(lleno('igual'), { op: 0.55 });
    }

    // ----- Leyendas -----
    const sw = (color, txt, cls = '') => `<span class="mec-sw"><i class="${cls}" style="background:${color}"></i>${txt}</span>`;
    const swVacio = txt => `<span class="mec-sw"><i class="vacio"></i>${txt}</span>`;
    const hayVacios = capa => sitios.some(s => (capa === 'sin' ? s.clase_siniestros : s.clase_velocidad) === 'sin_datos');
    function leyenda(html) { d3.select('#mecLegend').html(html); }
    function leyendaMapa(capa) {
      if (capa === 'sin') {
        leyenda(`<span class="mec-sw"><b>Siniestros graves frente al control:</b></span>` +
          sw(COL.baja_fuerte, `${fmt(uS1)} % o menos`) + sw(COL.baja, `${fmt(uS1)} a ${fmt(uS2)} %`) +
          sw(COL.igual, `entre ${fmt(uS2)} y ${fmt(uS3)} %`) + sw(COL.sube, `${fmt(uS3)} a ${fmt(uS4)} %`) +
          sw(COL.sube_fuerte, `${fmt(uS4)} % o más`) + (hayVacios('sin') ? swVacio('pocos datos') : '') +
          `<span class="mec-nota">Tamaño del círculo: siniestros graves por año antes de las cámaras.</span>`);
      } else if (capa === 'vel') {
        leyenda(`<span class="mec-sw"><b>Velocidad p85 nocturna frente al control:</b></span>` +
          sw(COL.baja_fuerte, `${fmt(uV1)} km/h o menos`) + sw(COL.baja, `${fmt(uV1)} a ${fmt(uV2)} km/h`) +
          sw(COL.igual, `entre ${fmt(uV2)} y ${fmt(uV3)} km/h`) + sw(COL.sube, `${fmt(uV3)} km/h o más`) +
          (hayVacios('vel') ? swVacio('sin sensor cercano') : '') +
          `<span class="mec-nota">Control: mediana de los tramos sin cámara (${fmt(ctrl.delta_p85_mediana, 1)} km/h de noche).</span>`);
      } else {
        const t = res.tabla_2x2 || { baja: { baja: 0, sube: 0 }, sube: { baja: 0, sube: 0 } };
        leyenda(sw(COL.baja_fuerte, 'bajan los dos') + sw(COL.sube_fuerte, 'suben los dos') + sw(COL.igual, 'el resto') +
          `<table class="mec-tabla" aria-label="Sitios según la dirección del cambio">
             <tr><th></th><th>Velocidad baja</th><th>Velocidad sube</th></tr>
             <tr><th>Siniestros bajan</th><td class="baja si">${t.baja.baja}</td><td>${t.baja.sube}</td></tr>
             <tr><th>Siniestros suben</th><td>${t.sube.baja}</td><td class="sube si">${t.sube.sube}</td></tr>
           </table>` +
          `<span class="mec-nota">Otros ${nf(res.n_cambio_pequeno ?? 0)} sitios tienen un cambio pequeño en alguna de las dos (entre ${fmt(uS2)} y ${fmt(uS3)} % o entre ${fmt(uV2)} y ${fmt(uV3)} km/h).</span>`);
      }
    }

    // ----- Escenas -----
    let escena = -1, capa = 'sin';
    const CAPA_DE_ESCENA = ['sin', 'vel', 'coi'];

    function dibujarMapa(D) {
      mostrar(['roads'], D);
      dots.style('pointer-events', null).attr('stroke-dasharray', d => estilo(d, capa).dash)
        .transition('pos').duration(D)
        .attr('cx', d => d._mx).attr('cy', d => d._my).attr('r', d => d._r)
        .attr('fill', d => estilo(d, capa).fill).attr('stroke', d => estilo(d, capa).stroke)
        .attr('stroke-width', 1.3).style('opacity', d => estilo(d, capa).op);
      leyendaMapa(capa);
    }

    function dibujarDispersion(D) {
      mostrar(['scat', 'scatTop'], D);
      dots.style('pointer-events', d => d._valid ? null : 'none').attr('stroke-dasharray', d => d._valid ? estilo(d, 'coi').dash : null)
        .transition('pos').duration(D)
        .attr('cx', d => d._valid ? d._sx : d._mx).attr('cy', d => d._valid ? d._sy : d._my).attr('r', d => d._r)
        .attr('fill', d => estilo(d, 'coi').fill).attr('stroke', d => estilo(d, 'coi').stroke)
        .style('opacity', d => d._valid ? 0.92 : 0);
      leyenda(`<span class="mec-sw"><b>r = ${nf(meta.r_pearson, 2)}</b>&nbsp;(Spearman ${nf(meta.r_spearman, 2)}, n = ${nf(meta.n_correlacion)})</span>` +
        sw(COL.ink2, 'tendencia (mínimos cuadrados)', 'linea') +
        sw(COL.franja, 'cambio pequeño', 'caja') +
        sw(COL.baja_fuerte, 'bajan los dos') + sw(COL.sube_fuerte, 'suben los dos') +
        `<span class="mec-nota">Los sitios que comparten sensor quedan en la misma columna. Las flechas marcan valores que se salen del eje.</span>`);
    }

    function ocultarSitios(D) {
      dots.style('pointer-events', 'none').transition('pos').duration(D).style('opacity', 0);
    }

    function render(i, animate = true) {
      if (i === escena) return;
      escena = i;
      const D = animate ? dur(750) : 0;
      d3.select('#mecToggle').classed('mec-toggle-off', i > 2).attr('aria-hidden', i > 2 ? 'true' : null)
        .selectAll('button').attr('tabindex', i > 2 ? -1 : null);
      tipHide();
      if (i <= 2) {
        capa = CAPA_DE_ESCENA[i];
        d3.select('#mecToggle').selectAll('button').attr('aria-pressed', d => d[0] === capa);
        dibujarMapa(D);
      } else if (i === 3) {
        dibujarDispersion(D);
      } else if (i === 4) {
        ocultarSitios(D); mostrar(['box'], D);
        leyenda(sw(COL.acc, `con cámara (${V.n_tramos_cam} tramos)`, 'caja') + sw(COL.ctrl, 'sin cámara', 'caja') +
          `<span class="mec-nota">Caja: mitad central de los tramos; línea: mediana; bigotes: hasta 1,5 × el rango intercuartílico; puntos: tramos fuera de los bigotes. Cambio = p85 después − p85 antes.</span>`);
      } else {
        ocultarSitios(D); mostrar(['slope'], D);
        leyenda(sw(COL.baja_fuerte, 'bajó su participación', 'linea') + sw(COL.sube_fuerte, 'subió', 'linea') + sw(COL.borde, 'otras condiciones', 'linea') +
          `<span class="mec-nota">Porcentaje de las víctimas (personas heridas o muertas) de cada condición. Antes: ${fmtMes(actores.antes[0])}–${fmtMes(actores.antes[1])}; después: ${fmtMes(actores.despues[0])}–${fmtMes(actores.despues[1])}.</span>`);
      }
    }

    seg('#mecToggle', [['sin', 'Siniestros'], ['vel', 'Velocidad'], ['coi', 'Coinciden']], () => capa,
      v => { capa = v; if (escena <= 2) dibujarMapa(dur(500)); });

    // ----- Dispersión: ejes, franjas, cuadrantes, recta -----
    function dibujarEjesDispersion() {
      const g = gScat;
      // franjas de "cambio pequeño" (umbrales de las clases)
      g.append('rect').attr('x', sx(uV2)).attr('width', sx(uV3) - sx(uV2)).attr('y', M.t).attr('height', H - M.t - M.b).attr('fill', COL.franja);
      g.append('rect').attr('x', M.l).attr('width', W - M.l - M.r).attr('y', sy(uS3)).attr('height', sy(uS2) - sy(uS3)).attr('fill', COL.franja);
      g.append('g').attr('transform', `translate(${M.l},0)`)
        .call(d3.axisLeft(sy).ticks(6).tickSize(-(W - M.l - M.r)).tickFormat(v => fmt(v) + ' %'))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', COL.line))
        .selectAll('text').attr('class', 'ax');
      g.append('g').attr('transform', `translate(0,${H - M.b})`)
        .call(d3.axisBottom(sx).ticks(8).tickSize(0).tickPadding(10).tickFormat(v => fmt(v)))
        .call(a => a.select('.domain').remove())
        .selectAll('text').attr('class', 'ax');
      // ejes cruzados en 0
      g.append('line').attr('x1', sx(0)).attr('x2', sx(0)).attr('y1', M.t).attr('y2', H - M.b).attr('stroke', COL.ink2).attr('stroke-width', 1.2);
      g.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', sy(0)).attr('y2', sy(0)).attr('stroke', COL.ink2).attr('stroke-width', 1.2);
      g.append('text').attr('class', 'ax').attr('x', W - M.r).attr('y', H - 14).attr('text-anchor', 'end')
        .text('Cambio de la velocidad p85 nocturna frente al control (km/h) →');
      g.append('text').attr('class', 'ax').attr('x', M.l - 4).attr('y', M.t - 16)
        .text('↑ Cambio de siniestros graves frente al control');
      // cuadrantes
      const q = [
        [M.l + 8, M.t + 44, 'start', 'Baja la velocidad · suben los siniestros', 'mec-cuad'],
        [W - M.r - 8, M.t + 44, 'end', 'Suben los dos', 'mec-cuad'],
        [M.l + 8, H - M.b - 10, 'start', 'Bajan los dos', 'mec-hl'],
        [W - M.r - 8, H - M.b - 10, 'end', 'Sube la velocidad · bajan los siniestros', 'mec-cuad']
      ];
      g.selectAll('text.q').data(q).join('text').attr('class', d => `q ${d[4]} halo`)
        .attr('x', d => d[0]).attr('y', d => d[1]).attr('text-anchor', d => d[2]).text(d => d[3]);

      // recta de tendencia + etiqueta de r, en la capa superior
      const rec = meta.recta || {};
      if (rec.pendiente != null && rec.intercepto != null) {
        const f = x => rec.pendiente * x + rec.intercepto;
        gScatTop.append('line').attr('clip-path', 'url(#mecClip)')
          .attr('x1', sx(x0)).attr('y1', sy(f(x0))).attr('x2', sx(x1)).attr('y2', sy(f(x1)))
          .attr('stroke', COL.ink2).attr('stroke-width', 2).attr('stroke-dasharray', '6 5');
        const xr = x1 - (x1 - x0) * 0.04, yr = f(xr);
        if (yr > y0 && yr < y1) {
          gScatTop.append('text').attr('class', 'labb halo').attr('x', sx(xr)).attr('y', sy(yr) - 10).attr('text-anchor', 'end')
            .text(`r = ${nf(meta.r_pearson, 2)}`);
        }
      }
      // etiquetas: los 3 sitios más extremos y los que se salen del eje
      const ax = Math.max(Math.abs(x0), Math.abs(x1)), ay = Math.max(Math.abs(y0), Math.abs(y1));
      const extremos = validos.slice()
        .sort((a, b) => ((b.delta_p85_vs_control / ax) ** 2 + (b.cambio_vs_control_pct / ay) ** 2) -
                        ((a.delta_p85_vs_control / ax) ** 2 + (a.cambio_vs_control_pct / ay) ** 2))
        .slice(0, 3);
      const etiquetar = new Set(extremos.concat(validos.filter(s => s._fuera)));
      const usados = [];
      [...etiquetar].forEach(s => {
        const derecha = s._sx < W - M.r - 170;
        let y = s._sy + 4;
        while (usados.some(u => Math.abs(u.y - y) < 14 && Math.abs(u.x - s._sx) < 160)) y += 14;
        usados.push({ x: s._sx, y });
        const fuera = s._fuera ? ` (${s.cambio_vs_control_pct > y1 ? '↑ ' : ''}${fmt(s.cambio_vs_control_pct)} %${s.delta_p85_vs_control > x1 ? `, → ${fmt(s.delta_p85_vs_control, 1)} km/h` : ''})` : '';
        gScatTop.append('text').attr('class', 'lab halo')
          .attr('x', s._sx + (derecha ? s._r + 6 : -s._r - 6)).attr('y', y)
          .attr('text-anchor', derecha ? 'start' : 'end')
          .text(pretty(s.corredor) + fuera);
      });
    }

    // ----- Cajas por franja (escena 5) -----
    function dibujarCajas() {
      const BM = { l: 58, r: 16, t: 44, b: 70 };
      const g = gBox;
      const stats = [];
      FRANJAS.forEach(([fr]) => {
        [['con', true], ['sin', false]].forEach(([k, cc]) => {
          const v = (expo[fr] || []).filter(e => e.con_camara === cc).map(e => e.delta_p85).sort(d3.ascending);
          if (!v.length) return;
          const q1 = d3.quantileSorted(v, 0.25), med = d3.quantileSorted(v, 0.5), q3 = d3.quantileSorted(v, 0.75), iqr = q3 - q1;
          const lo = d3.min(v.filter(x => x >= q1 - 1.5 * iqr)), hi = d3.max(v.filter(x => x <= q3 + 1.5 * iqr));
          stats.push({ fr, k, n: v.length, q1, med, q3, lo, hi, out: v.filter(x => x < lo || x > hi) });
        });
      });
      const all = FRANJAS.flatMap(([fr]) => (expo[fr] || []).map(e => e.delta_p85));
      const y = d3.scaleLinear().domain(d3.extent(all.length ? all : [-1, 1])).nice().range([H - BM.b, BM.t]);
      const bx = d3.scaleBand().domain(FRANJAS.map(f => f[0])).range([BM.l, W - BM.r]).paddingInner(0.2).paddingOuter(0.1);
      const bi = d3.scaleBand().domain(['con', 'sin']).range([0, bx.bandwidth()]).padding(0.16);
      const color = k => k === 'con' ? COL.acc : COL.ctrl;

      // NOCHE resaltada
      const pad = bx.step() * bx.paddingInner() / 2;
      g.append('rect').attr('x', bx('NOCHE') - pad).attr('width', bx.bandwidth() + 2 * pad)
        .attr('y', BM.t - 30).attr('height', H - BM.t - BM.b + 30).attr('fill', COL.franja);
      g.append('g').attr('transform', `translate(${BM.l},0)`)
        .call(d3.axisLeft(y).ticks(8).tickSize(-(W - BM.l - BM.r)).tickFormat(v => fmt(v)))
        .call(a => a.select('.domain').remove())
        .call(a => a.selectAll('.tick line').attr('stroke', v => v === 0 ? COL.ink2 : COL.line))
        .selectAll('text').attr('class', 'ax');
      g.append('text').attr('class', 'ax').attr('x', BM.l - 4).attr('y', 16)
        .text('↑ Cambio de velocidad p85 por tramo (km/h), antes → después');
      g.selectAll('text.fr').data(FRANJAS).join('text')
        .attr('class', d => d[0] === 'NOCHE' ? 'fr mec-hl' : 'fr labb')
        .attr('x', d => bx(d[0]) + bx.bandwidth() / 2).attr('y', H - BM.b + 26).attr('text-anchor', 'middle').text(d => d[1]);
      g.selectAll('text.sub').data(FRANJAS).join('text').attr('class', 'sub ax')
        .attr('x', d => bx(d[0]) + bx.bandwidth() / 2).attr('y', H - BM.b + 44).attr('text-anchor', 'middle').text('con · sin');

      const cajas = g.selectAll('g.caja').data(stats).join('g').attr('class', 'caja')
        .attr('transform', d => `translate(${bx(d.fr) + bi(d.k)},0)`);
      const w = bi.bandwidth(), cx = w / 2;
      cajas.append('line').attr('x1', cx).attr('x2', cx).attr('y1', d => y(d.lo)).attr('y2', d => y(d.hi)).attr('stroke', d => color(d.k)).attr('stroke-width', 1.4);
      cajas.append('line').attr('x1', w * 0.25).attr('x2', w * 0.75).attr('y1', d => y(d.lo)).attr('y2', d => y(d.lo)).attr('stroke', d => color(d.k)).attr('stroke-width', 1.4);
      cajas.append('line').attr('x1', w * 0.25).attr('x2', w * 0.75).attr('y1', d => y(d.hi)).attr('y2', d => y(d.hi)).attr('stroke', d => color(d.k)).attr('stroke-width', 1.4);
      cajas.selectAll('circle').data(d => d.out.map(v => ({ v, k: d.k }))).join('circle')
        .attr('cx', cx).attr('cy', o => y(o.v)).attr('r', 1.8).attr('fill', o => color(o.k)).attr('opacity', 0.45);
      cajas.append('rect').attr('x', 0).attr('width', w).attr('y', d => y(d.q3)).attr('height', d => Math.max(1, y(d.q1) - y(d.q3)))
        .attr('fill', d => d.k === 'con' ? COL.acc3 : COL.fondo).attr('stroke', d => color(d.k)).attr('stroke-width', 1.4);
      cajas.append('line').attr('x1', 0).attr('x2', w).attr('y1', d => y(d.med)).attr('y2', d => y(d.med)).attr('stroke', d => color(d.k)).attr('stroke-width', 3);
      cajas.append('rect').attr('x', 0).attr('width', w).attr('y', d => y(d.hi) - 4).attr('height', d => y(d.lo) - y(d.hi) + 8).attr('fill', 'transparent')
        .on('mousemove', (ev, d) => tipShow(
          `<b>${FRANJAS.find(f => f[0] === d.fr)[1]} · ${d.k === 'con' ? 'con cámara' : 'sin cámara'}</b><br>` +
          `${nf(d.n)} tramos<br>mediana <b>${fmt(d.med, 1)} km/h</b><br>mitad central: ${fmt(d.q1, 1)} a ${fmt(d.q3, 1)} km/h`, ev))
        .on('mouseleave', tipHide);
      // valores de la mediana en NOCHE
      stats.filter(d => d.fr === 'NOCHE').forEach(d => {
        g.append('text').attr('class', 'labb halo').attr('text-anchor', 'middle')
          .attr('x', bx(d.fr) + bi(d.k) + w / 2).attr('y', y(d.hi) - 8).text(fmt(d.med, 1));
      });
    }

    // ----- Pendientes por condición (escena 6) -----
    function dibujarPendientes() {
      const g = gSlope;
      const paneles = [['CERCA', `Cerca de las cámaras (≤ ${meta.radio_m} m)`], ['CONTROL', 'Resto de la ciudad']];
      const cats = actores.categorias;
      const filas = [];
      paneles.forEach(([k]) => cats.forEach(c => filas.push({ g: k, c, a: share(k, 'antes', c), d: share(k, 'despues', c) })));
      const top = 96, bottom = H - 56;
      const vals = filas.flatMap(f => [f.a, f.d]).filter(v => v != null);
      const y = d3.scaleLinear().domain([Math.max(0, (d3.min(vals) ?? 0) - 3), (d3.max(vals) ?? 10) + 3]).range([bottom, top]);
      const pw = (W - 20) / 2;
      paneles.forEach(([k, titulo], p) => {
        const px = 10 + p * pw, xa = px + 78, xd = px + 196;
        const gp = g.append('g');
        gp.append('text').attr('class', 'labb').attr('x', px + 8).attr('y', 30).text(titulo);
        gp.append('text').attr('class', 'ax').attr('x', xa).attr('y', 64).attr('text-anchor', 'middle').text('Antes');
        gp.append('text').attr('class', 'ax').attr('x', xd).attr('y', 64).attr('text-anchor', 'middle').text('Después');
        gp.append('line').attr('x1', xa).attr('x2', xa).attr('y1', top - 14).attr('y2', bottom).attr('stroke', COL.line);
        gp.append('line').attr('x1', xd).attr('x2', xd).attr('y1', top - 14).attr('y2', bottom).attr('stroke', COL.line);
        const fp = filas.filter(f => f.g === k && f.a != null && f.d != null)
          .sort((a, b) => DESTACADAS.includes(a.c) - DESTACADAS.includes(b.c));
        const col = f => DESTACADAS.includes(f.c) ? (f.d < f.a ? COL.baja_fuerte : COL.sube_fuerte) : COL.borde;
        fp.forEach(f => {
          const hl = DESTACADAS.includes(f.c);
          gp.append('line').attr('x1', xa).attr('x2', xd).attr('y1', y(f.a)).attr('y2', y(f.d))
            .attr('stroke', col(f)).attr('stroke-width', hl ? 3.5 : 1.6).attr('opacity', hl ? 1 : 0.8);
          [[xa, f.a, 'antes'], [xd, f.d, 'después']].forEach(([x, v, per]) => {
            gp.append('circle').attr('cx', x).attr('cy', y(v)).attr('r', hl ? 5 : 3.5).attr('fill', col(f)).attr('stroke', COL.fondo).attr('stroke-width', 1.5)
              .on('mousemove', ev => tipShow(`<b>${CAT_LABEL[f.c] || f.c}</b> · ${titulo.toLowerCase()}<br>${per}: <b>${pct(v)}</b> de las víctimas<br>cambio: ${fmt(f.d - f.a, 1)} puntos`, ev))
              .on('mouseleave', tipHide);
          });
        });
        // etiquetas sin solaparse
        const etiquetas = (lado) => {
          const items = fp.map(f => ({ f, y: y(lado === 'a' ? f.a : f.d) + 4 })).sort((a, b) => a.y - b.y);
          for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 16) items[i].y = items[i - 1].y + 16;
          const exceso = items.length ? items[items.length - 1].y - (bottom + 4) : 0;
          if (exceso > 0) items.forEach(it => { it.y -= exceso; });
          return items;
        };
        etiquetas('a').forEach(({ f, y: yy }) => {
          gp.append('text').attr('class', DESTACADAS.includes(f.c) ? 'labb' : 'ax').attr('x', xa - 10).attr('y', yy).attr('text-anchor', 'end').text(pct(f.a));
        });
        etiquetas('d').forEach(({ f, y: yy }) => {
          const hl = DESTACADAS.includes(f.c);
          gp.append('text').attr('class', hl ? 'labb' : 'ax').attr('x', xd + 10).attr('y', yy)
            .text(`${CAT_LABEL[f.c] || f.c} ${pct(f.d)}`);
        });
      });
    }

    // ----- Observador de pasos -----
    let io;
    function observar() {
      if (io) io.disconnect();
      io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          d3.selectAll('.mec-step').classed('is-active', false);
          d3.select(e.target).classed('is-active', true);
          render(+e.target.dataset.mscene);
        });
      }, { rootMargin: esMovil() ? '-72% 0px -18% 0px' : '-45% 0px -45% 0px' });
      pasosVisibles.each(function () { io.observe(this); });
    }
    render(0, false);
    d3.select('.mec-step[data-mscene="0"]').classed('is-active', true);
    observar();
    let movil = esMovil(), rt;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (esMovil() !== movil) { movil = esMovil(); observar(); } }, 200);
    });
  }
})();

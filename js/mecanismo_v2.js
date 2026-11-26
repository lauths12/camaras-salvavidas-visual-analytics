/* Página «Del resultado al mecanismo (v2)» (mecanismo_v2.html).
   Basada en js/mecanismo.js (que no se modifica). Cambios:
   - Escenas 1-2 nuevas: cómo se mide (tramos Bitcarrier, sitio = radio de 250 m, tramos a 50 m).
   - Se quitan las escenas de cajas por franja y pendientes por actor; lo que mostraban se
     descubre en un mapa explorable (sección #explorar) */
(function () {
  'use strict';
  const root = document.getElementById('mecanismo');
  if (!root || typeof d3 === 'undefined') return;

  // ---------- Helpers locales ----------
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
    d3.json('data/actores_mecanismo.json').catch(() => null),
    d3.json('data/actores_por_sitio.json').catch(() => null),
    d3.json('data/calidad_geocod.json').catch(() => null)
  ]).then(([mec, tramos, expo, actores, actSitio, geo]) => {
    init(mec, tramos, expo, actores, actSitio, geo);
  }).catch(err => {
    console.error('[mecanismo v2]', err);
    d3.select('#mecNota').text(`No se pudieron cargar los datos de esta página (${err.message}). Si abriste el archivo directamente, sirve la carpeta con python -m http.server.`);
  });

  // ---------- Constantes ----------
  const W = 720, H = 640;
  const FRANJAS = [['MADRUGADA', 'Madrugada'], ['PICO_MANANA', 'Pico mañana'], ['VALLE', 'Mediodía'], ['PICO_TARDE', 'Pico tarde'], ['NOCHE', 'Noche']];
  const FR_LABEL = Object.fromEntries(FRANJAS);
  const CAT_LABEL = { PEATON: 'Peatón', MOTOCICLISTA: 'Motociclista', CICLISTA: 'Ciclista', PASAJERO: 'Pasajero', CONDUCTOR: 'Conductor' };
  const CAT_PLURAL = { PEATON: 'peatones', MOTOCICLISTA: 'motociclistas', CICLISTA: 'ciclistas', PASAJERO: 'pasajeros', CONDUCTOR: 'conductores' };
  const MIN_VICTIMAS = 15;   // por periodo, para colorear un sitio en la capa de víctimas

  function init(mec, tramos, expo, actores, actSitio, geo) {
    const meta = mec.meta, res = meta.resumen || {}, ctrl = mec.control;
    const [uS1, uS2, uS3, uS4] = meta.umbrales_siniestros_pct;
    const [uV1, uV2, uV3] = meta.umbrales_velocidad_kmh;
    const COL = {
      baja_fuerte: C('--mec-baja-fuerte'), baja: C('--mec-baja'), igual: C('--mec-igual'),
      sube: C('--mec-sube'), sube_fuerte: C('--mec-sube-fuerte'), borde: C('--mec-borde'),
      franja: C('--mec-franja'), fondo: C('--bg'), road: C('--road2'), ctrl: C('--ctrl'),
      acc: C('--acc'), acc2: C('--acc2'), acc3: C('--acc3'), line: C('--line'), muted: C('--muted'),
      ink: C('--ink'), ink2: C('--ink2')
    };

    // ----- Color bivariado: 4 esquinas (siniestros × velocidad) y gris en el centro -----
    // Clave: 1.ª letra = siniestros (b baja / s sube), 2.ª = velocidad.
    const BIV = { bb: C('--v2-bb'), bs: C('--v2-bs'), sb: C('--v2-sb'), ss: C('--v2-ss'), centro: C('--v2-centro') };
    const S_FULL = Math.abs(uS4), V_FULL = Math.abs(uV1);   // ±40 % y ±5 km/h = color pleno
    const clamp1 = v => Math.max(-1, Math.min(1, v));
    function bivColor(sv, vv) {
      const y = sv == null ? 0 : clamp1(sv / S_FULL), x = vv == null ? 0 : clamp1(vv / V_FULL);
      const r = Math.max(Math.abs(x), Math.abs(y));
      if (r === 0) return BIV.centro;
      const u = (x / r + 1) / 2, v = (y / r + 1) / 2;    // dirección normalizada a la esquina
      const bajo = d3.interpolateHcl(BIV.bb, BIV.bs)(u), alto = d3.interpolateHcl(BIV.sb, BIV.ss)(u);
      return d3.interpolateLab(BIV.centro, d3.interpolateHcl(bajo, alto)(v))(Math.pow(r, 0.85));
    }
    const gradCSS = (fn) => `linear-gradient(90deg, ${d3.range(0, 1.0001, 0.125).map(t => fn(-1 + 2 * t)).join(',')})`;
    const barra = (fn, izq, der) => `<span class="v2-grad"><span>${izq}</span><i style="background:${gradCSS(fn)}"></i><span>${der}</span></span>`;
    function leyenda2D(n = 7) {
      const c = 13, pad = 4, size = n * c;
      let cells = '';
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        const x = -1 + 2 * i / (n - 1), y = 1 - 2 * j / (n - 1);
        cells += `<rect x="${pad + i * c}" y="${pad + j * c}" width="${c}" height="${c}" fill="${bivColor(y * S_FULL, x * V_FULL)}"/>`;
      }
      return `<span class="v2-biv"><svg viewBox="0 0 ${size + 2 * pad} ${size + 2 * pad}" width="${size + 2 * pad}" height="${size + 2 * pad}" aria-hidden="true">${cells}</svg>` +
        `<span class="v2-biv-ax"><b style="color:${BIV.ss}">↗ suben los dos</b><b style="color:${BIV.sb}">↖ suben siniestros, baja velocidad</b>` +
        `<b style="color:${BIV.bs}">↘ bajan siniestros, sube velocidad</b><b style="color:${BIV.bb}">↙ bajan los dos</b>` +
        `<span>→ velocidad · ↑ siniestros (frente al control). Gris: cambio pequeño.</span></span></span>`;
    }

    // ----- Sitios -----
    const aniosAntes = (meta.meses_antes || 22) / 12;
    const sitios = mec.sitios.slice();
    const proj = d3.geoMercator().fitExtent([[30, 24], [W - 30, H - 24]], tramos);
    const path = d3.geoPath(proj);
    const rS = d3.scaleSqrt().domain([0, d3.max(sitios, s => s.graves_antes / aniosAntes) || 1]).range([4, 12]);
    sitios.forEach(s => {
      [s._mx, s._my] = proj([s.lon, s.lat]);
      s._r = rS(s.graves_antes / aniosAntes);
      s._valid = s.tiene_velocidad && !s.pocos_datos && s.cambio_vs_control_pct != null && s.delta_p85_vs_control != null;
      s._r250 = Math.abs(proj([s.lon, s.lat + meta.radio_m / 111320])[1] - s._my);
    });
    sitios.sort((a, b) => b._r - a._r);
    const validos = sitios.filter(s => s._valid);
    const tramosCam = tramos.features.filter(f => f.properties.con_camara);

    // Ejemplo para la escena 2: el sitio con más tramos asignados (y más siniestros, para desempatar).
    const ejemplo = sitios.slice().sort((a, b) => (b.tids || []).length - (a.tids || []).length || b.graves_antes - a.graves_antes)[0];
    const tidsEj = new Set((ejemplo.tids || []).map(String));

    const M = { l: 66, r: 26, t: 40, b: 62 };
    const xsV = validos.map(s => s.delta_p85_vs_control), ysV = validos.map(s => s.cambio_vs_control_pct);
    const X_TOPE = 12, Y_TOPE = 200;
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

    // ----- Velocidad por franja (tramo y sitio) -----
    const velFr = {};       // franja -> Map(tid -> registro)
    const medFr = {};       // franja -> {con, sin, nCon, nSin}
    FRANJAS.forEach(([fr]) => {
      const arr = expo[fr] || [];
      velFr[fr] = new Map(arr.map(e => [String(e.tid), e]));
      const con = arr.filter(e => e.con_camara).map(e => e.delta_p85);
      const sin = arr.filter(e => !e.con_camara).map(e => e.delta_p85);
      medFr[fr] = { con: con.length ? d3.median(con) : null, sin: sin.length ? d3.median(sin) : null, nCon: con.length, nSin: sin.length };
    });
    const velSitio = (s, fr) => {
      const v = (s.tids || []).map(t => velFr[fr].get(String(t))).filter(e => e && e.delta_p85 != null);
      return v.length ? d3.mean(v, e => e.delta_p85) : null;
    };

    // ----- Víctimas -----
    const share = (g, p, c) => {
      if (!actores || !actores.grupos[g]) return null;
      const t = d3.sum(Object.values(actores.grupos[g][p]));
      return t ? 100 * actores.grupos[g][p][c] / t : null;
    };
    const shareSitio = (sid, p, c) => {
      const o = actSitio && actSitio.sitios[sid];
      if (!o) return { v: null, n: 0 };
      const t = d3.sum(Object.values(o[p]));
      return { v: t ? 100 * o[p][c] / t : null, n: t };
    };

    // ----- Cifras para los textos -----
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
    const nTid = (ejemplo.tids || []).length;
    const V = {
      n_tramos: nf(tramos.features.length),
      n_tramos_cam_red: nf(tramosCam.length),
      n_camaras: nf(d3.sum(sitios, s => s.n_camaras)),
      err_geo: geo && geo.error_mediano_m ? `${nf(Math.round(geo.error_mediano_m / 10) * 10)} m` : '170 m',
      ej_corredor: `${pretty(ejemplo.corredor)} (${ejemplo.sitio})`,
      ej_n_tramos: `${nTid} tramo${nTid === 1 ? '' : 's'}`,
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
      n_tramos_cam: noche.filter(e => e.con_camara).length
    };
    d3.selectAll('[data-mec]').each(function () {
      const v = V[this.dataset.mec];
      this.textContent = v == null ? '—' : v;
    });

    // ----- Portada: mapa de fondo + cifras clave -----
    function drawHero() {
      const cv = document.getElementById('heroRoads');
      if (!cv) return;
      const box = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = box.width * dpr; cv.height = box.height * dpr;
      const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
      const w = box.width, h = box.height, left = w > 820 ? w * 0.5 : 0;
      const pj = d3.geoMercator().fitExtent([[left, 20], [w - 20, h - 20]], tramos);
      const p = d3.geoPath(pj, ctx);
      ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round';
      tramos.features.forEach(f => {
        ctx.beginPath(); p(f);
        ctx.strokeStyle = COL.road; ctx.globalAlpha = f.properties.con_camara ? .9 : .5;
        ctx.lineWidth = f.properties.con_camara ? 1.6 : 1;
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      sitios.forEach(s => {
        const [x, y] = pj([s.lon, s.lat]);
        const col = s._valid ? bivColor(s.cambio_vs_control_pct, s.delta_p85_vs_control) : COL.muted;
        ctx.beginPath(); ctx.arc(x, y, 3.4, 0, 7);
        ctx.fillStyle = col; ctx.strokeStyle = COL.fondo; ctx.lineWidth = 1.2;
        ctx.fill(); ctx.stroke();
      });

      const tiles = [
        { big: `${V.n_bajan_ambos} de ${V.n_con_ambos}`, cls: 'neg', d: 'sitios donde bajaron a la vez la velocidad y la fatalidad' },
        { big: nf(V.n_suben_ambos), cls: 'pos', d: 'sitios donde subieron las dos a la vez' },
        { big: `r = ${V.r_pearson}`, cls: 'mid', d: 'correlación entre cambio de velocidad y de siniestros, sitio por sitio' }
      ];
      d3.select('#mecHeroStats').selectAll('div').data(tiles).join('div').html(d => `<span class="big ${d.cls}">${d.big}</span><span>${d.d}</span>`);
    }
    drawHero();
    let rtHero; addEventListener('resize', () => { clearTimeout(rtHero); rtHero = setTimeout(drawHero, 200); });
    const coverDown = document.getElementById('mecCoverDown');
    if (coverDown) coverDown.addEventListener('click', () => {
      document.querySelector('.mec-cover-stats').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    });

    // ----- Nota de fuentes y limitaciones -----
    const errGeo = geo && geo.error_mediano_m ? `${nf(geo.error_mediano_m)} m` : 'unos 170 m';
    d3.select('#mecNota').html(
      `<b>Fuentes:</b> SIGAT (siniestralidad 2018–2022), Cámaras Salvavidas Bogotá y Bitcarrier (velocidad y red vial), Datos Abiertos de Movilidad Bogotá. ` +
      `Siniestros graves = con heridos o con muertos, a ${meta.radio_m} m o menos del sitio; el control es el resto de la ciudad. ` +
      `Antes: ${fmtMes(meta.antes[0])}–${fmtMes(meta.antes[1])}; después: ${fmtMes(meta.despues[0])}–${fmtMes(meta.despues[1])}. Las tasas son por mes porque los dos periodos no duran lo mismo. ` +
      `<br><b>Limitaciones:</b> los siniestros de 2018 a 2021 están geocodificados desde la dirección (error mediano ${errGeo}); por eso se usa un radio de ${meta.radio_m} m. ` +
      `Desde octubre de 2021 casi no hay datos de velocidad en los tramos con cámara, así que el «después» de velocidad es más corto que el de siniestros. ` +
      `2020 se excluye por la cuarentena. ` +
      `Varios sitios comparten el mismo tramo de sensor, así que los ${nf(meta.n_correlacion)} sitios de la correlación tienen solo ${V.n_tramos_distintos} combinaciones de velocidad distintas: es una señal descriptiva, no una prueba causal. ` +
      (actores ? `En el explorador, las víctimas «antes» son de ${fmtMes(actores.antes[0])}–${fmtMes(actores.antes[1])}, porque el anuario 2018 no separa motociclistas ni ciclistas; los sitios con menos de ${MIN_VICTIMAS} víctimas en algún periodo se marcan como «pocos datos».` : '')
    );

    // ======================================================================
    //  SCROLLYTELLING
    // ======================================================================
    const svg = d3.select('#mecGraph').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    svg.selectAll('*').remove();
    const defs = svg.append('defs');
    defs.append('clipPath').attr('id', 'mecClip').append('rect')
      .attr('x', M.l).attr('y', M.t).attr('width', W - M.l - M.r).attr('height', H - M.t - M.b);
    defs.append('clipPath').attr('id', 'mecMapClip').append('rect').attr('width', W).attr('height', H);
    const gMap = svg.append('g').attr('clip-path', 'url(#mecMapClip)').append('g');
    const gRoads = gMap.append('g').attr('class', 'mec-l-roads');
    const gMed = gMap.append('g').attr('class', 'mec-l-med').style('opacity', 0);
    const gScat = svg.append('g').attr('class', 'mec-l-scat').style('opacity', 0);
    const gDots = svg.append('g').attr('class', 'mec-l-dots');
    const gScatTop = svg.append('g').attr('class', 'mec-l-scattop').style('opacity', 0);
    const capas = { roads: gRoads, med: gMed, scat: gScat, scatTop: gScatTop };

    function mostrar(nombres, D) {
      Object.entries(capas).forEach(([k, g]) => {
        const on = nombres.includes(k);
        g.style('pointer-events', on ? null : 'none').transition('vis').duration(D).style('opacity', on ? 1 : 0);
      });
    }

    gRoads.selectAll('path').data(tramos.features).join('path')
      .attr('d', path).attr('fill', 'none').attr('stroke', COL.road).attr('stroke-width', 1.1)
      .attr('vector-effect', 'non-scaling-stroke');

    // ----- Capa de medición (escenas 1-2) -----
    const medTramosCam = gMed.append('g').selectAll('path').data(tramosCam).join('path')
      .attr('d', path).attr('fill', 'none').attr('stroke', COL.acc).attr('stroke-width', 2.6)
      .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke');
    const medCirc = gMed.append('g').style('opacity', 0);
    medCirc.selectAll('circle').data(sitios).join('circle')
      .attr('cx', d => d._mx).attr('cy', d => d._my).attr('r', d => d._r250)
      .attr('fill', COL.acc3).attr('fill-opacity', 0.45).attr('stroke', COL.acc).attr('stroke-width', 1.2)
      .attr('vector-effect', 'non-scaling-stroke');
    const medCentros = medCirc.append('g').selectAll('circle').data(sitios).join('circle')
      .attr('cx', d => d._mx).attr('cy', d => d._my).attr('r', 2).attr('fill', COL.ink);
    const medEj = gMed.append('g').style('opacity', 0);
    medEj.selectAll('path').data(tramos.features.filter(f => tidsEj.has(String(f.properties.tid)))).join('path')
      .attr('d', path).attr('fill', 'none').attr('stroke', COL.ink).attr('stroke-width', 4.5)
      .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke');
    const ejLbl = medEj.append('text').attr('class', 'labb halo').attr('text-anchor', 'middle');

    // Zoom de la escena 2 sobre el sitio de ejemplo
    const K_EJ = 9;
    const tEj = d3.zoomIdentity.translate(W / 2, H / 2).scale(K_EJ).translate(-ejemplo._mx, -ejemplo._my);
    function zoomMapa(t, D) {
      gMap.transition('zoom').duration(D).attr('transform', t.toString());
      medCentros.transition('zoom').duration(D).attr('r', 2.4 / t.k);
      ejLbl.attr('x', ejemplo._mx).attr('y', ejemplo._my - ejemplo._r250 - 8 / t.k)
        .style('font-size', `${14 / t.k}px`).style('stroke-width', `${5 / t.k}px`)
        .text(`${pretty(ejemplo.corredor)} · radio de ${meta.radio_m} m`);
    }

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

    function estilo(d, capa) {
      const vacio = { fill: COL.fondo, stroke: COL.borde, dash: '2.5 2', op: 1 };
      const lleno = color => ({ fill: color, stroke: COL.fondo, dash: null, op: 1 });
      const sOK = d.clase_siniestros !== 'sin_datos' && d.cambio_vs_control_pct != null;
      const vOK = d.clase_velocidad !== 'sin_datos' && d.delta_p85_vs_control != null;
      if (capa === 'sin') return sOK ? lleno(bivColor(d.cambio_vs_control_pct, null)) : vacio;
      if (capa === 'vel') return vOK ? lleno(bivColor(null, d.delta_p85_vs_control)) : vacio;
      if (!sOK || !vOK) return Object.assign({}, vacio, { op: 0.5 });
      return lleno(bivColor(d.cambio_vs_control_pct, d.delta_p85_vs_control));
    }

    // ----- Leyendas -----
    const sw = (color, txt, cls = '') => `<span class="mec-sw"><i class="${cls}" style="background:${color}"></i>${txt}</span>`;
    const swVacio = txt => `<span class="mec-sw"><i class="vacio"></i>${txt}</span>`;
    const hayVacios = capa => sitios.some(s => (capa === 'sin' ? s.clase_siniestros : s.clase_velocidad) === 'sin_datos');
    function leyenda(html) { d3.select('#mecLegend').html(html); }
    function leyendaMapa(capa) {
      if (capa === 'sin') {
        leyenda(`<span class="mec-sw"><b>Siniestros graves frente al control:</b></span>` +
          barra(t => bivColor(t * S_FULL, null), `${fmt(-S_FULL)} % o menos`, `${fmt(S_FULL)} % o más`) +
          (hayVacios('sin') ? swVacio('pocos datos') : '') +
          `<span class="mec-nota">Tamaño del círculo: siniestros graves por año antes de las cámaras. Los mismos colores son el eje vertical del mapa «Coinciden».</span>`);
      } else if (capa === 'vel') {
        leyenda(`<span class="mec-sw"><b>Velocidad p85 nocturna frente al control:</b></span>` +
          barra(t => bivColor(null, t * V_FULL), `${fmt(-V_FULL)} km/h o menos`, `${fmt(V_FULL)} km/h o más`) +
          (hayVacios('vel') ? swVacio('sin sensor cercano') : '') +
          `<span class="mec-nota">Control: mediana de los tramos sin cámara (${fmt(ctrl.delta_p85_mediana, 1)} km/h de noche). Los mismos colores son el eje horizontal del mapa «Coinciden».</span>`);
      } else {
        const t = res.tabla_2x2 || { baja: { baja: 0, sube: 0 }, sube: { baja: 0, sube: 0 } };
        leyenda(leyenda2D() +
          `<table class="mec-tabla" aria-label="Sitios según la dirección del cambio">
             <tr><th></th><th>Velocidad baja</th><th>Velocidad sube</th></tr>
             <tr><th>Siniestros bajan</th><td class="si" style="background:${BIV.bb}">${t.baja.baja}</td><td class="si" style="background:${BIV.bs}">${t.baja.sube}</td></tr>
             <tr><th>Siniestros suben</th><td class="si" style="background:${BIV.sb}">${t.sube.baja}</td><td class="si" style="background:${BIV.ss}">${t.sube.sube}</td></tr>
           </table>` +
          `<span class="mec-nota">Otros ${nf(res.n_cambio_pequeno ?? 0)} sitios tienen un cambio pequeño en alguna de las dos (entre ${fmt(uS2)} y ${fmt(uS3)} % o entre ${fmt(uV2)} y ${fmt(uV3)} km/h).</span>`);
      }
    }

    // ----- Escenas -----
    let escena = -1, capa = 'sin';
    const CAPA_DE_ESCENA = { 2: 'sin', 3: 'vel', 4: 'coi' };

    function dibujarMedicion(i, D) {
      mostrar(['roads', 'med'], D);
      ocultarSitios(D);
      medCirc.transition('m').duration(D).style('opacity', i === 1 ? 1 : 0);
      medEj.transition('m').duration(D).style('opacity', i === 1 ? 1 : 0);
      medTramosCam.transition('m').duration(D).attr('stroke', i === 1 ? COL.acc2 : COL.acc);
      zoomMapa(i === 1 ? tEj : d3.zoomIdentity, D);
      if (i === 0) {
        leyenda(`<span class="mec-sw"><i class="linea" style="background:${COL.road}"></i>tramo con sensor de velocidad (${V.n_tramos})</span>` +
          sw(COL.acc, `tramo con cámara a 50 m o menos (${V.n_tramos_cam_red})`, 'linea') +
          `<span class="mec-nota">La velocidad se resume con el percentil 85 (p85): la velocidad que solo supera el 15 % más rápido de los vehículos.</span>`);
      } else {
        leyenda(sw(COL.acc3, `radio de ${meta.radio_m} m alrededor del sitio: sus siniestros`) +
          sw(COL.ink, `tramos a 50 m o menos: su velocidad`, 'linea') +
          `<span class="mec-nota">Si un siniestro queda cerca de dos sitios, cuenta para el más cercano.</span>`);
      }
    }

    function dibujarMapa(D) {
      mostrar(['roads'], D);
      zoomMapa(d3.zoomIdentity, D);
      dots.style('pointer-events', null).attr('stroke-dasharray', d => estilo(d, capa).dash)
        .transition('pos').duration(D)
        .attr('cx', d => d._mx).attr('cy', d => d._my).attr('r', d => d._r)
        .attr('fill', d => estilo(d, capa).fill).attr('stroke', d => estilo(d, capa).stroke)
        .attr('stroke-width', 1.3).style('opacity', d => estilo(d, capa).op);
      leyendaMapa(capa);
    }

    function dibujarDispersion(D) {
      mostrar(['scat', 'scatTop'], D);
      zoomMapa(d3.zoomIdentity, D);
      dots.style('pointer-events', d => d._valid ? null : 'none').attr('stroke-dasharray', d => d._valid ? estilo(d, 'coi').dash : null)
        .transition('pos').duration(D)
        .attr('cx', d => d._valid ? d._sx : d._mx).attr('cy', d => d._valid ? d._sy : d._my).attr('r', d => d._r)
        .attr('fill', d => estilo(d, 'coi').fill).attr('stroke', COL.ink2).attr('stroke-width', 0.8)
        .style('opacity', d => d._valid ? 1 : 0);
      leyenda(leyenda2D(5) +
        `<span class="mec-sw"><b>r = ${nf(meta.r_pearson, 2)}</b>&nbsp;(Spearman ${nf(meta.r_spearman, 2)}, n = ${nf(meta.n_correlacion)})</span>` +
        sw(COL.ink2, 'tendencia (mínimos cuadrados)', 'linea') +
        `<span class="mec-nota">El fondo y los puntos usan los mismos colores del mapa «Coinciden». Los sitios que comparten sensor quedan en la misma columna. Las flechas marcan valores que se salen del eje.</span>`);
    }

    function ocultarSitios(D) {
      dots.style('pointer-events', 'none').transition('pos').duration(D).style('opacity', 0);
    }

    function render(i, animate = true) {
      if (i === escena) return;
      escena = i;
      const D = animate ? dur(750) : 0;
      const conToggle = i >= 2 && i <= 4;
      d3.select('#mecToggle').classed('mec-toggle-off', !conToggle).attr('aria-hidden', conToggle ? null : 'true')
        .selectAll('button').attr('tabindex', conToggle ? null : -1);
      tipHide();
      if (i <= 1) {
        dibujarMedicion(i, D);
      } else if (i <= 4) {
        capa = CAPA_DE_ESCENA[i];
        d3.select('#mecToggle').selectAll('button').attr('aria-pressed', d => d[0] === capa);
        dibujarMapa(D);
      } else {
        dibujarDispersion(D);
      }
    }

    seg('#mecToggle', [['sin', 'Siniestros'], ['vel', 'Velocidad'], ['coi', 'Coinciden']], () => capa,
      v => { capa = v; if (escena >= 2 && escena <= 4) dibujarMapa(dur(500)); });

    dibujarEjesDispersion();

    // ----- Dispersión: ejes, franjas, cuadrantes, recta -----
    function dibujarEjesDispersion() {
      const g = gScat;
      // fondo con el gradiente bivariado: muestra en qué zona de color cae cada punto
      const NX = 48, NY = 48, cw = (W - M.l - M.r) / NX, ch = (H - M.t - M.b) / NY;
      const fondo = [];
      for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
        fondo.push({ x: M.l + i * cw, y: M.t + j * ch, c: bivColor(sy.invert(M.t + (j + 0.5) * ch), sx.invert(M.l + (i + 0.5) * cw)) });
      }
      g.append('g').attr('opacity', 0.32).selectAll('rect').data(fondo).join('rect')
        .attr('x', d => d.x).attr('y', d => d.y).attr('width', cw + 0.6).attr('height', ch + 0.6).attr('fill', d => d.c);
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
      g.append('line').attr('x1', sx(0)).attr('x2', sx(0)).attr('y1', M.t).attr('y2', H - M.b).attr('stroke', COL.ink2).attr('stroke-width', 1.2);
      g.append('line').attr('x1', M.l).attr('x2', W - M.r).attr('y1', sy(0)).attr('y2', sy(0)).attr('stroke', COL.ink2).attr('stroke-width', 1.2);
      g.append('text').attr('class', 'ax').attr('x', W - M.r).attr('y', H - 14).attr('text-anchor', 'end')
        .text('Cambio de la velocidad p85 nocturna frente al control (km/h) →');
      g.append('text').attr('class', 'ax').attr('x', M.l - 4).attr('y', M.t - 16)
        .text('↑ Cambio de siniestros graves frente al control');
      const q = [
        [M.l + 8, M.t + 44, 'start', 'Baja la velocidad · suben los siniestros', 'mec-cuad'],
        [W - M.r - 8, M.t + 44, 'end', 'Suben los dos', 'mec-cuad'],
        [M.l + 8, H - M.b - 10, 'start', 'Bajan los dos', 'mec-hl'],
        [W - M.r - 8, H - M.b - 10, 'end', 'Sube la velocidad · bajan los siniestros', 'mec-cuad']
      ];
      g.selectAll('text.q').data(q).join('text').attr('class', d => `q ${d[4]} halo`)
        .attr('x', d => d[0]).attr('y', d => d[1]).attr('text-anchor', d => d[2]).text(d => d[3]);

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

    // ----- Observador de pasos -----
    const pasos = d3.selectAll('.mec-step');
    let io;
    function observar() {
      if (io) io.disconnect();
      io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          pasos.classed('is-active', false);
          d3.select(e.target).classed('is-active', true);
          render(+e.target.dataset.mscene);
        });
      }, { rootMargin: esMovil() ? '-72% 0px -18% 0px' : '-45% 0px -45% 0px' });
      pasos.each(function () { io.observe(this); });
    }
    render(0, false);
    d3.select('.mec-step[data-mscene="0"]').classed('is-active', true);
    observar();
    let movil = esMovil(), rt;
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (esMovil() !== movil) { movil = esMovil(); observar(); } }, 200);
    });

    // ======================================================================
    //  EXPLORADOR
    // ======================================================================
    explorador();

    function explorador() {
      // sel: null | {tipo:'sitio', id} | {tipo:'tramo', id}
      const E = { lay: 'vel', fr: 'NOCHE', cond: 'PEATON', sel: null };
      const xsvg = d3.select('#xMap').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
      const gZ = xsvg.append('g');
      let T = d3.zoomIdentity;
      const zoom = d3.zoom().scaleExtent([1, 14]).translateExtent([[-200, -200], [W + 200, H + 200]])
        .on('zoom', ev => { T = ev.transform; gZ.attr('transform', T); escalarSitios(); });
      xsvg.call(zoom).on('dblclick.zoom', null);
      d3.select('#xIn').on('click', () => xsvg.transition().duration(dur(300)).call(zoom.scaleBy, 1.6));
      d3.select('#xOut').on('click', () => xsvg.transition().duration(dur(300)).call(zoom.scaleBy, 1 / 1.6));
      d3.select('#xReset').on('click', () => xsvg.transition().duration(dur(400)).call(zoom.transform, d3.zoomIdentity));
      xsvg.on('click', ev => { if (ev.defaultPrevented) return; if (!['circle', 'path'].includes(ev.target.tagName)) seleccionar(null); });

      const colVel = v => v == null ? COL.road : bivColor(null, v);      // mismo eje de color que el mapa de velocidad
      const clasePP = v => v == null ? null : v <= -5 ? 'baja_fuerte' : v <= -2 ? 'baja' : v < 2 ? 'igual' : v < 5 ? 'sube' : 'sube_fuerte';
      const sitioDe = id => sitios.find(s => s.sitio === id);
      const featDe = tid => tramos.features.find(f => String(f.properties.tid) === String(tid));
      const nombreTramo = p => `${(p.via || 'Tramo').replace(/;/g, ' / ')}${p.entre ? ' · ' + p.entre.replace(';', ' a ') : ''}`;

      // Tramos resaltados por la selección actual
      function tidsSel() {
        if (!E.sel) return new Set();
        if (E.sel.tipo === 'tramo') return new Set([String(E.sel.id)]);
        const s = sitioDe(E.sel.id);
        return new Set((s && s.tids || []).map(String));
      }

      const feats = tramos.features.slice().sort((a, b) => a.properties.con_camara - b.properties.con_camara);
      const gTr = gZ.append('g');
      const gHi = gZ.append('g').style('pointer-events', 'none');   // contorno de los tramos seleccionados
      const gHiTop = gZ.append('g').style('pointer-events', 'none');
      const xTramos = gTr.selectAll('path').data(feats).join('path')
        .attr('d', path).attr('fill', 'none').attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer')
        .on('mousemove', (ev, f) => {
          if (E.lay !== 'vel') return;
          const e = velFr[E.fr].get(String(f.properties.tid));
          tipShow(`<b>${nombreTramo(f.properties)}</b><br>` +
            (f.properties.con_camara ? `<span style="color:${COL.acc}">Con cámara (${f.properties.n_camaras})</span>` : 'Sin cámara') + `<br>` +
            (e ? `${FR_LABEL[E.fr]}: p85 ${nf(e.p85_antes, 1)} → ${nf(e.p85_despues, 1)} km/h (<b>${fmt(e.delta_p85, 1)}</b>)` : `${FR_LABEL[E.fr]}: sin dato`) +
            `<br><span style="opacity:.65">Clic para ver el detalle</span>`, ev);
        })
        .on('mouseleave', tipHide)
        .on('click', (ev, f) => {
          if (E.lay !== 'vel') return;
          ev.stopPropagation();
          const id = String(f.properties.tid);
          seleccionar(E.sel && E.sel.tipo === 'tramo' && E.sel.id === id ? null : { tipo: 'tramo', id });
        });

      const xDots = gZ.append('g').selectAll('circle').data(sitios, d => d.sitio).join('circle')
        .attr('cx', d => d._mx).attr('cy', d => d._my).style('cursor', 'pointer')
        .on('mousemove', (ev, d) => tipShow(tipX(d), ev))
        .on('mouseleave', tipHide)
        .on('click', (ev, d) => {
          ev.stopPropagation();
          seleccionar(E.sel && E.sel.tipo === 'sitio' && E.sel.id === d.sitio ? null : { tipo: 'sitio', id: d.sitio });
        });

      function datoSitio(d) {
        if (E.lay === 'vel') {
          const v = velSitio(d, E.fr);
          const m = medFr[E.fr].sin;
          return { v: v == null || m == null ? null : v - m, raw: v };
        }
        const a = shareSitio(d.sitio, 'antes', E.cond), b = shareSitio(d.sitio, 'despues', E.cond);
        const ctrlCambio = share('CONTROL', 'despues', E.cond) - share('CONTROL', 'antes', E.cond);
        const pocos = a.n < MIN_VICTIMAS || b.n < MIN_VICTIMAS || a.v == null || b.v == null;
        return { v: pocos ? null : (b.v - a.v) - ctrlCambio, a, b, pocos };
      }
      function tipX(d) {
        const x = datoSitio(d);
        if (E.lay === 'vel') {
          return `<b>${pretty(d.corredor)}</b> <span style="opacity:.65">· ${d.sitio}</span><br>` +
            (x.raw == null ? 'Sin sensor cercano' :
              `${FR_LABEL[E.fr]}: p85 <b>${fmt(x.raw, 1)} km/h</b><br>frente al control: <b>${fmt(x.v, 1)} km/h</b>`) +
            `<br><span style="opacity:.65">Clic para ver el detalle</span>`;
        }
        return `<b>${pretty(d.corredor)}</b> <span style="opacity:.65">· ${d.sitio}</span><br>` +
          `${CAT_LABEL[E.cond]}: ${pct(x.a.v)} → ${pct(x.b.v)} de las víctimas<br>` +
          (x.pocos ? `<span style="opacity:.65">Pocos datos (${x.a.n} y ${x.b.n} víctimas)</span>` : `frente al control: <b>${fmt(x.v, 1)} puntos</b>`) +
          `<br><span style="opacity:.65">Clic para ver el detalle</span>`;
      }

      const esSitioSel = d => E.sel && E.sel.tipo === 'sitio' && E.sel.id === d.sitio;
      function escalarSitios() {
        const k = Math.sqrt(T.k);
        xDots.attr('r', d => (E.lay === 'vic' ? rVic(d) : 5.5) * (esSitioSel(d) ? 1.35 : 1) / k)
          .attr('stroke-width', d => (esSitioSel(d) ? 3 : 1.3) / k);
      }
      const nVicMax = actSitio ? d3.max(Object.values(actSitio.sitios), o => d3.sum(Object.values(o.antes)) + d3.sum(Object.values(o.despues))) : 1;
      const rV = d3.scaleSqrt().domain([0, nVicMax || 1]).range([3, 13]);
      const rVic = d => {
        const o = actSitio && actSitio.sitios[d.sitio];
        return o ? rV(d3.sum(Object.values(o.antes)) + d3.sum(Object.values(o.despues))) : 3;
      };

      function pintar() {
        const vel = E.lay === 'vel';
        const hi = tidsSel();
        const hayHi = hi.size > 0;
        const colTramo = f => {
          if (!vel) return f.properties.con_camara ? COL.acc2 : COL.road;
          const e = velFr[E.fr].get(String(f.properties.tid));
          return colVel(e ? e.delta_p85 : null);
        };
        const anchoTramo = f => f.properties.con_camara ? (vel ? 3.4 : 2) : (vel ? 1.4 : 1.1);
        xTramos
          .attr('stroke', colTramo)
          .attr('stroke-width', anchoTramo)
          .attr('stroke-opacity', f => hayHi ? (hi.has(String(f.properties.tid)) ? 1 : 0.25) : (vel && !f.properties.con_camara ? 0.6 : 1))
          .style('pointer-events', vel ? null : 'none');
        // Resaltado: contorno oscuro y el tramo con su color encima
        const fh = feats.filter(f => hi.has(String(f.properties.tid)));
        gHi.selectAll('path').data(fh, f => f.properties.tid).join('path')
          .attr('d', path).attr('fill', 'none').attr('stroke', COL.ink).attr('stroke-width', 9)
          .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke');
        gHiTop.selectAll('path').data(fh, f => f.properties.tid).join('path')
          .attr('d', path).attr('fill', 'none').attr('stroke', f => vel ? colTramo(f) : COL.acc2).attr('stroke-width', 4.5)
          .attr('stroke-linecap', 'round').attr('vector-effect', 'non-scaling-stroke');

        xDots.each(function (d) {
          const x = datoSitio(d);
          const el = d3.select(this);
          if (vel) {
            el.attr('fill', esSitioSel(d) ? COL.ink : COL.fondo).attr('stroke', COL.ink).attr('stroke-dasharray', null);
          } else if (x.v == null) {
            el.attr('fill', COL.fondo).attr('stroke', esSitioSel(d) ? COL.ink : COL.borde).attr('stroke-dasharray', esSitioSel(d) ? null : '2.5 2');
          } else {
            const c = clasePP(x.v);
            el.attr('fill', COL[c]).attr('stroke', esSitioSel(d) ? COL.ink : (c === 'igual' ? COL.borde : COL.fondo)).attr('stroke-dasharray', null);
          }
        });
        xDots.filter(esSitioSel).raise();
        escalarSitios();
        leyendaX();
        lado();
        resumen();
        ficha();
      }

      const lg = (color, txt) => `<span><i class="c" style="background:${color};border:1px solid ${COL.borde}"></i>${txt}</span>`;
      function leyendaX() {
        if (E.lay === 'vel') {
          d3.select('#xLegend').html(`<div class="lg-g"><span class="lg-t">Cambio p85 · ${FR_LABEL[E.fr].toLowerCase()}</span></div>` +
            `<div class="lg-g">${barra(t => colVel(t * V_FULL), `${fmt(-V_FULL)} km/h`, `${fmt(V_FULL)} km/h`)}</div>` +
            `<div class="lg-g"><span>grueso = con cámara · ○ = sitio</span></div>`);
        } else {
          d3.select('#xLegend').html(`<div class="lg-g"><span class="lg-t">${CAT_LABEL[E.cond]}: cambio en su % de víctimas, frente al control</span></div>` +
            `<div class="lg-g">${lg(COL.baja_fuerte, '−5 pts o menos')}${lg(COL.baja, '−5 a −2')}${lg(COL.igual, '±2')}${lg(COL.sube, '+2 a +5')}${lg(COL.sube_fuerte, '+5 o más')}</div>` +
            `<div class="lg-g"><span><i class="c" style="background:#fff;border:1px dashed ${COL.borde}"></i>pocos datos</span><span>tamaño = n.º de víctimas</span></div>`);
        }
      }

      // ----- Panel lateral -----
      const SW = 440, SH = 180;
      const gSide = d3.select('#xSideG').attr('viewBox', `0 0 ${SW} ${SH}`);
      const todosDeltas = FRANJAS.flatMap(([fr]) => (expo[fr] || []).map(e => e.delta_p85)).sort(d3.ascending);
      const lim = Math.max(Math.abs(d3.quantileSorted(todosDeltas, 0.01) ?? -10), Math.abs(d3.quantileSorted(todosDeltas, 0.99) ?? 10));
      const xs = d3.scaleLinear().domain([-lim, lim]).nice().range([14, SW - 14]).clamp(true);
      const jit = i => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;

      function lado() {
        gSide.selectAll('*').remove();
        if (E.lay === 'vel') {
          const m = medFr[E.fr];
          const hi = tidsSel();
          d3.select('#xSideT').text(`Velocidad · ${FR_LABEL[E.fr]}`);
          d3.select('#xSideSub').text('Cada punto es un tramo: cuánto cambió su p85 entre antes y después. La línea gruesa es la mediana de cada grupo. Clic en un punto para seleccionar su tramo.');
          const filas = [[true, 52, COL.acc, `Con cámara (${m.nCon})`], [false, 128, COL.ctrl, `Sin cámara (${m.nSin})`]];
          gSide.append('line').attr('x1', xs(0)).attr('x2', xs(0)).attr('y1', 18).attr('y2', SH - 22).attr('stroke', COL.ink2);
          gSide.append('g').attr('transform', `translate(0,${SH - 20})`)
            .call(d3.axisBottom(xs).ticks(5).tickSize(0).tickPadding(6).tickFormat(v => fmt(v)))
            .call(a => a.select('.domain').remove()).selectAll('text').attr('class', 'ax');
          const resaltados = [];
          filas.forEach(([cc, y, col, txt]) => {
            const arr = (expo[E.fr] || []).filter(e => e.con_camara === cc)
              .map((e, i) => ({ e, x: xs(e.delta_p85), y: y - 14 + jit(i + (cc ? 0 : 999)) * 28, on: hi.has(String(e.tid)) }));
            gSide.append('text').attr('class', 'ax').attr('x', 14).attr('y', y - 26).text(txt);
            gSide.append('g').selectAll('circle').data(arr.filter(o => !o.on)).join('circle')
              .attr('cx', o => o.x).attr('cy', o => o.y)
              .attr('r', cc ? 2.6 : 1.8).attr('fill', col).attr('opacity', hi.size ? 0.25 : (cc ? 0.75 : 0.35))
              .style('cursor', 'pointer')
              .on('mousemove', (ev, o) => {
                const f = featDe(o.e.tid);
                tipShow(`<b>${f ? nombreTramo(f.properties) : 'Tramo ' + o.e.tid}</b><br>${FR_LABEL[E.fr]}: ${nf(o.e.p85_antes, 1)} → ${nf(o.e.p85_despues, 1)} km/h (<b>${fmt(o.e.delta_p85, 1)}</b>)`, ev);
              })
              .on('mouseleave', tipHide)
              .on('click', (ev, o) => seleccionar({ tipo: 'tramo', id: String(o.e.tid) }, true));
            arr.filter(o => o.on).forEach(o => resaltados.push(o));
            const med = cc ? m.con : m.sin;
            if (med != null) {
              gSide.append('line').attr('x1', xs(med)).attr('x2', xs(med)).attr('y1', y - 18).attr('y2', y + 18).attr('stroke', COL.ink).attr('stroke-width', 3);
              gSide.append('text').attr('class', 'labb halo').attr('x', xs(med) + 6).attr('y', y - 18).text(`${fmt(med, 1)} km/h`);
            }
          });
          // puntos de los tramos seleccionados: grandes, con contorno y etiqueta
          const gR = gSide.append('g');
          gR.selectAll('circle').data(resaltados).join('circle')
            .attr('cx', o => o.x).attr('cy', o => o.y).attr('r', 6)
            .attr('fill', o => colVel(o.e.delta_p85)).attr('stroke', COL.ink).attr('stroke-width', 2.2)
            .on('mousemove', (ev, o) => tipShow(`<b>${fmt(o.e.delta_p85, 1)} km/h</b>`, ev)).on('mouseleave', tipHide);
          if (resaltados.length === 1) {
            gR.selectAll('text').data(resaltados).join('text').attr('class', 'labb halo')
              .attr('x', o => o.x).attr('y', o => o.y + 20).attr('text-anchor', 'middle').style('font-size', '12px')
              .text(o => fmt(o.e.delta_p85, 1));
          }
          if (E.sel && !resaltados.length) {
            gR.append('text').attr('class', 'ax').attr('x', SW - 14).attr('y', 14).attr('text-anchor', 'end').text('La selección no tiene dato en esta franja');
          }
          const sitiosFr = sitios.map(s => ({ s, v: velSitio(s, E.fr) })).filter(o => o.v != null);
          const subenMas = sitiosFr.filter(o => o.v - m.sin >= 2).length, bajanMas = sitiosFr.filter(o => o.v - m.sin <= -2).length;
          d3.select('#xSideTxt').html(
            `<p>Mediana con cámara <b>${fmt(m.con, 1)} km/h</b>, sin cámara <b>${fmt(m.sin, 1)} km/h</b>: diferencia de <b>${fmt(m.con - m.sin, 1)} km/h</b>.</p>` +
            `<p>De ${sitiosFr.length} sitios con sensor, <b>${subenMas}</b> aceleraron 2 km/h o más frente al control en esta franja y <b>${bajanMas}</b> frenaron 2 km/h o más.</p>`);
        } else {
          const c = E.cond;
          const cA = share('CERCA', 'antes', c), cD = share('CERCA', 'despues', c);
          const kA = share('CONTROL', 'antes', c), kD = share('CONTROL', 'despues', c);
          d3.select('#xSideT').text(`Víctimas · ${CAT_PLURAL[c]}`);
          d3.select('#xSideSub').text(`Qué porcentaje de las personas heridas o muertas eran ${CAT_PLURAL[c]}, antes (${fmtMes(actores.antes[0])}–${fmtMes(actores.antes[1])}) y después (${fmtMes(actores.despues[0])}–${fmtMes(actores.despues[1])}).`);
          const s = E.sel && E.sel.tipo === 'sitio' ? sitioDe(E.sel.id) : null;
          const xsS = s ? datoSitio(s) : null;
          const series = [['Cerca', cA, cD, COL.acc, 3.5], ['Resto', kA, kD, COL.ctrl, 2.2]];
          if (xsS && xsS.a.v != null && xsS.b.v != null) series.push([s.sitio, xsS.a.v, xsS.b.v, COL.ink, 2.5]);
          const vals = series.flatMap(d => [d[1], d[2]]).filter(v => v != null);
          const y = d3.scaleLinear().domain([Math.max(0, d3.min(vals) - 4), d3.max(vals) + 4]).range([SH - 26, 26]);
          const xa = 150, xd = 300;
          gSide.append('text').attr('class', 'ax').attr('x', xa).attr('y', 14).attr('text-anchor', 'middle').text('Antes');
          gSide.append('text').attr('class', 'ax').attr('x', xd).attr('y', 14).attr('text-anchor', 'middle').text('Después');
          [xa, xd].forEach(x => gSide.append('line').attr('x1', x).attr('x2', x).attr('y1', 22).attr('y2', SH - 20).attr('stroke', COL.line));
          series.forEach(([nom, a, d, col, w], i) => {
            gSide.append('line').attr('x1', xa).attr('x2', xd).attr('y1', y(a)).attr('y2', y(d)).attr('stroke', col).attr('stroke-width', w)
              .attr('stroke-dasharray', i === 2 ? '5 4' : null);
            gSide.append('circle').attr('cx', xa).attr('cy', y(a)).attr('r', 4).attr('fill', col);
            gSide.append('circle').attr('cx', xd).attr('cy', y(d)).attr('r', 4).attr('fill', col);
            gSide.append('text').attr('class', 'ax').attr('x', xa - 8).attr('y', y(a) + 4).attr('text-anchor', 'end').text(`${nom} ${pct(a)}`);
            gSide.append('text').attr('class', 'labb').attr('x', xd + 8).attr('y', y(d) + 4).text(pct(d));
          });
          const filas = sitios.map(s => ({ s, x: datoSitio(s) })).filter(o => o.x.v != null);
          const bajan = filas.filter(o => o.x.v <= -2).length, suben = filas.filter(o => o.x.v >= 2).length;
          const top = filas.slice().sort((a, b) => a.x.v - b.x.v);
          const li = o => `<li data-sitio="${o.s.sitio}"${s && s.sitio === o.s.sitio ? ' class="on"' : ''}><span>${pretty(o.s.corredor)} <span style="color:${COL.muted}">${o.s.sitio}</span></span><span>${fmt(o.x.v, 1)}</span></li>`;
          d3.select('#xSideTxt').html(
            `<p>Cerca de las cámaras: de <b>${pct(cA)}</b> a <b>${pct(cD)}</b> (${fmt(cD - cA, 1)} puntos). Resto de la ciudad: de <b>${pct(kA)}</b> a <b>${pct(kD)}</b> (${fmt(kD - kA, 1)} puntos).</p>` +
            `<p>De ${filas.length} sitios con datos suficientes, en <b>${bajan}</b> su participación bajó 2 puntos o más frente al control y en <b>${suben}</b> subió.</p>` +
            `<p class="side-t" style="margin-top:4px">Más bajó · más subió (puntos)</p>` +
            `<ul class="v2-rank">${top.slice(0, 3).map(li).join('')}${top.slice(-3).reverse().map(li).join('')}</ul>`);
          d3.selectAll('#xSideTxt .v2-rank li').on('click', function () { seleccionar({ tipo: 'sitio', id: this.dataset.sitio }, true); });
        }
      }

      function resumen() {
        const s = E.sel && E.sel.tipo === 'sitio' ? sitioDe(E.sel.id) : null;
        const f = E.sel && E.sel.tipo === 'tramo' ? featDe(E.sel.id) : null;
        const selTxt = s ? `, con el sitio <b>${pretty(s.corredor)}</b> (${s.sitio}) seleccionado` : f ? `, con el tramo <b>${nombreTramo(f.properties)}</b> seleccionado` : '';
        d3.select('#xSum').html(E.lay === 'vel'
          ? `Viendo <b>velocidad por tramo</b> en la franja <b>${FR_LABEL[E.fr].toLowerCase()}</b>${selTxt}. Haz clic en un tramo, en un sitio o en un punto de la gráfica de la derecha.`
          : `Viendo <b>víctimas por sitio</b>: ${CAT_PLURAL[E.cond]}${selTxt}. Azul: su participación bajó más que en el resto de la ciudad; naranja: subió más.`);
      }

      // ----- Detalle (debajo del mapa, no encima) -----
      function barrasFranja(filas, ext) {
        const bw = 300, bh = 104, by = d3.scaleBand().domain(FRANJAS.map(f => f[0])).range([2, bh - 2]).padding(0.25);
        const bx = d3.scaleLinear().domain([-ext, ext]).range([92, bw - 42]);
        const barras = filas.map(f => {
          const y = by(f.fr), h = by.bandwidth();
          const on = E.lay === 'vel' && f.fr === E.fr;
          const lab = `<text x="0" y="${y + h - 2}" class="${on ? 'labb' : 'ax'}" style="font-size:12px">${FR_LABEL[f.fr]}</text>`;
          if (f.v == null) return lab + `<text x="${bx(0) + 4}" y="${y + h - 2}" class="ax">sin dato</text>`;
          return lab + `<rect x="${Math.min(bx(0), bx(f.v))}" y="${y}" width="${Math.abs(bx(f.v) - bx(0))}" height="${h}" fill="${colVel(f.v)}" ${on ? `stroke="${COL.ink}" stroke-width="1.5"` : ''}/>` +
            `<text x="${f.v >= 0 ? bx(f.v) + 4 : bx(f.v) - 4}" y="${y + h - 2}" text-anchor="${f.v >= 0 ? 'start' : 'end'}" class="ax" style="font-size:11.5px">${fmt(f.v, 1)}</text>`;
        }).join('');
        return `<svg viewBox="0 0 ${bw} ${bh}"><line x1="${bx(0)}" x2="${bx(0)}" y1="0" y2="${bh}" stroke="${COL.ink2}"/>${barras}</svg>`;
      }
      const cerrar = `<button type="button" class="pin-x" aria-label="Cerrar detalle">×</button>`;

      function ficha() {
        const box = d3.select('#xFicha');
        if (!E.sel) { box.attr('hidden', true).html(''); return; }
        if (E.sel.tipo === 'sitio') fichaSitio(box, sitioDe(E.sel.id)); else fichaTramo(box, featDe(E.sel.id));
        box.attr('hidden', null);
        box.select('.pin-x').on('click', () => seleccionar(null));
        box.selectAll('[data-tid]').on('click', function () { seleccionar({ tipo: 'tramo', id: this.dataset.tid }, true); });
        box.selectAll('[data-sitio]').on('click', function () { seleccionar({ tipo: 'sitio', id: this.dataset.sitio }, true); });
      }

      function fichaSitio(box, d) {
        const filasVel = FRANJAS.map(([fr]) => {
          const v = velSitio(d, fr), m = medFr[fr].sin;
          return { fr, v: v == null || m == null ? null : v - m };
        });
        const ext = Math.max(4, d3.max(filasVel, f => Math.abs(f.v ?? 0)) || 4);
        const o = actSitio && actSitio.sitios[d.sitio];
        const tA = o ? d3.sum(Object.values(o.antes)) : 0, tD = o ? d3.sum(Object.values(o.despues)) : 0;
        const tablaAct = o && tA && tD
          ? `<table><tr><th>Víctima</th><th>Antes</th><th>Después</th><th>Ciudad</th></tr>` +
            actores.categorias.map(c => `<tr class="${E.lay === 'vic' && c === E.cond ? 'on' : ''}"><td>${CAT_LABEL[c]}</td><td>${pct(100 * o.antes[c] / tA, 0)}</td><td>${pct(100 * o.despues[c] / tD, 0)}</td><td style="color:${COL.muted}">${pct(share('CONTROL', 'antes', c), 0)} → ${pct(share('CONTROL', 'despues', c), 0)}</td></tr>`).join('') +
            `</table><p class="sub">${tA} víctimas antes · ${tD} después${tA < MIN_VICTIMAS || tD < MIN_VICTIMAS ? ' · pocos datos' : ''}</p>`
          : `<p class="sub">Sin víctimas registradas.</p>`;
        const tr = (d.tids || []).map(t => {
          const f = featDe(t), e = velFr[E.fr].get(String(t));
          return `<li data-tid="${t}"><span>${f ? nombreTramo(f.properties) : 'Tramo ' + t}</span><span>${e ? fmt(e.delta_p85, 1) + ' km/h' : '—'}</span></li>`;
        }).join('');
        const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${d.lat},${d.lon}`;
        box.html(cerrar +
          `<div class="v2-ficha-h"><h4>${pretty(d.corredor)}</h4><p class="sub">Sitio ${d.sitio} · ${d.n_camaras} cámara${d.n_camaras === 1 ? '' : 's'} · activa desde ${fmtFecha(d.fecha_activacion)} · siniestros graves ${nf(d.graves_antes)} → ${nf(d.graves_despues)}</p></div>` +
          `<div class="v2-ficha-c"><p class="lbl">Velocidad p85 frente al control, por franja (km/h)</p>${barrasFranja(filasVel, ext)}</div>` +
          `<div class="v2-ficha-c"><p class="lbl">A quién afectan sus siniestros (% de víctimas)</p>${tablaAct}</div>` +
          `<div class="v2-ficha-c"><p class="lbl">Sus tramos de sensor (resaltados en el mapa) · ${FR_LABEL[E.fr].toLowerCase()}</p>` +
          (tr ? `<ul class="v2-rank">${tr}</ul>` : '<p class="sub">Sin sensor cercano.</p>') +
          `<a class="pin-sv" href="${sv}" target="_blank" rel="noopener">Ver en Street View</a></div>`);
      }

      function fichaTramo(box, f) {
        const p = f.properties, tid = String(p.tid);
        const filas = FRANJAS.map(([fr]) => ({ fr, e: velFr[fr].get(tid), m: medFr[fr].sin }));
        const ext = Math.max(4, d3.max(filas, r => Math.abs(r.e ? r.e.delta_p85 : 0)) || 4);
        const tabla = `<table><tr><th>Franja</th><th>p85 antes</th><th>después</th><th>cambio</th><th>sin cámara</th></tr>` +
          filas.map(r => `<tr class="${E.lay === 'vel' && r.fr === E.fr ? 'on' : ''}"><td>${FR_LABEL[r.fr]}</td>` +
            (r.e ? `<td>${nf(r.e.p85_antes, 1)}</td><td>${nf(r.e.p85_despues, 1)}</td><td>${fmt(r.e.delta_p85, 1)}</td>` : `<td colspan="3" style="color:${COL.muted}">sin dato</td>`) +
            `<td style="color:${COL.muted}">${fmt(r.m, 1)}</td></tr>`).join('') + `</table>`;
        const ids = (p.sitios || '').split(';').filter(Boolean);
        const lista = ids.map(id => { const s = sitioDe(id); return `<li data-sitio="${id}"><span>${s ? pretty(s.corredor) : id}</span><span style="color:${COL.muted}">${id}</span></li>`; }).join('');
        box.html(cerrar +
          `<div class="v2-ficha-h"><h4>${nombreTramo(p)}</h4><p class="sub">Tramo ${tid} · ${nf(p.distancia_m / 1000, 1)} km · ${p.con_camara ? `<b style="color:${COL.acc}">con cámara</b> (${p.n_camaras})` : 'sin cámara'}</p></div>` +
          `<div class="v2-ficha-c"><p class="lbl">Cambio de la velocidad p85 por franja (km/h)</p>${barrasFranja(filas.map(r => ({ fr: r.fr, v: r.e ? r.e.delta_p85 : null })), ext)}</div>` +
          `<div class="v2-ficha-c"><p class="lbl">Velocidad p85 (km/h) y mediana de los tramos sin cámara</p>${tabla}</div>` +
          `<div class="v2-ficha-c"><p class="lbl">Sitios con cámara que usan este tramo</p>` +
          (lista ? `<ul class="v2-rank">${lista}</ul>` : '<p class="sub">Ninguno: es un tramo de control.</p>') + `</div>`);
      }

      function seleccionar(sel, centrar = false) {
        E.sel = sel;
        tipHide();
        pintar();
        if (sel && centrar) {
          let cx, cy;
          if (sel.tipo === 'sitio') { const d = sitioDe(sel.id); cx = d._mx; cy = d._my; }
          else { const c = path.centroid(featDe(sel.id)); [cx, cy] = c; }
          const k = sel.tipo === 'sitio' ? Math.max(T.k, 4) : Math.max(T.k, 1.5);
          xsvg.transition().duration(dur(600)).call(zoom.transform, d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-cx, -cy));
        }
      }

      // ----- Controles -----
      const xLay = d3.select('#xLay');
      xLay.selectAll('button').data([['vel', 'Velocidad por tramo'], ['vic', 'Víctimas por sitio']]).join('button')
        .attr('type', 'button').attr('role', 'tab').text(d => d[1])
        .on('click', (ev, d) => {
          E.lay = d[0];
          if (E.lay === 'vic' && E.sel && E.sel.tipo === 'tramo') E.sel = null;
          actualizarControles(); pintar();
        });
      seg('#xFranja', FRANJAS, () => E.fr, v => { E.fr = v; pintar(); });
      seg('#xCond', actores ? actores.categorias.map(c => [c, CAT_LABEL[c]]) : [], () => E.cond, v => { E.cond = v; pintar(); });
      function actualizarControles() {
        xLay.selectAll('button').attr('aria-selected', d => d[0] === E.lay);
        d3.select('#xFranjaCtl').attr('hidden', E.lay === 'vel' ? null : true);
        d3.select('#xCondCtl').attr('hidden', E.lay === 'vic' ? null : true);
      }
      if (!actSitio || !actores) xLay.selectAll('button').filter(d => d[0] === 'vic').attr('disabled', true);
      actualizarControles();
      pintar();
    }
  }
})();

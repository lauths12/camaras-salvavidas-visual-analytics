const tooltip = d3.select("body").append("div").attr("class", "tooltip");

function mostrarTooltip(evento, html) {
  tooltip
    .style("opacity", 1)
    .html(html)
    .style("left", evento.clientX + 14 + "px")
    .style("top", evento.clientY + 14 + "px");
}

function ocultarTooltip() {
  tooltip.style("opacity", 0);
}

function dibujarMapa(camaras, tramosGeo) {
  const svg = d3.select("#mapa-svg");
  const ancho = 960, alto = 760;
  const proyeccion = d3.geoMercator().fitSize([ancho - 20, alto - 20], tramosGeo);
  const camino = d3.geoPath(proyeccion);

  const zoomCapa = svg.append("g").attr("class", "zoom-capa");

  zoomCapa.append("rect")
    .attr("x", 0).attr("y", 0).attr("width", ancho).attr("height", alto)
    .attr("fill", "transparent");

  zoomCapa.append("g")
    .attr("transform", "translate(10,10)")
    .selectAll("path")
    .data(tramosGeo.features)
    .join("path")
    .attr("d", camino)
    .attr("fill", "none")
    .attr("stroke", d => d.properties.con_camara ? "#ff8a3d" : "#2a3346")
    .attr("stroke-width", d => d.properties.con_camara ? 2 : 1)
    .attr("opacity", d => d.properties.con_camara ? 0.95 : 0.55)
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `Tramo ${d.properties.tid}<br>${d.properties.via ?? ""} → ${d.properties.entre ?? ""}<br>${d.properties.con_camara ? d.properties.n_camaras + " cámara(s)" : "sin cámara"}`))
    .on("mouseleave", ocultarTooltip);

  zoomCapa.append("g")
    .attr("transform", "translate(10,10)")
    .selectAll("circle")
    .data(camaras)
    .join("circle")
    .attr("cx", d => proyeccion([d.lon, d.lat])[0])
    .attr("cy", d => proyeccion([d.lon, d.lat])[1])
    .attr("r", 3.2)
    .attr("fill", "#4fb6ff")
    .attr("stroke", "#0f1420")
    .attr("stroke-width", 0.6)
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `${d.sitio}<br>${d.nombre ?? ""}<br>${d.corredor ?? ""}`))
    .on("mouseleave", ocultarTooltip);

  const zoom = d3.zoom()
    .scaleExtent([1, 10])
    .on("zoom", (evento) => zoomCapa.attr("transform", evento.transform));

  svg.call(zoom);

  const leyenda = d3.select("#mapa-leyenda");
  const items = [
    ["#ff8a3d", "Tramo con cámara (≤ 50 m)"],
    ["#2a3346", "Tramo de control"],
    ["#4fb6ff", "Cámara"],
  ];
  leyenda.selectAll("div").data(items).join("div")
    .attr("class", "leyenda-item")
    .html(d => `<span class="leyenda-punto" style="background:${d[0]}"></span>${d[1]}`);
}

function dibujarRanking(filas) {
  const datos = filas.filter(d => d.cambio_pct !== null).slice(0, 15);
  const margen = { top: 10, right: 30, bottom: 20, left: 170 };
  const ancho = 900, alto = Math.max(300, datos.length * 26 + margen.top + margen.bottom);
  const svg = d3.select("#ranking-svg").attr("viewBox", `0 0 ${ancho} ${alto}`);

  const x = d3.scaleLinear()
    .domain(d3.extent(datos, d => d.cambio_pct)).nice()
    .range([margen.left, ancho - margen.right]);
  const y = d3.scaleBand()
    .domain(datos.map(d => d.corredor))
    .range([margen.top, alto - margen.bottom])
    .padding(0.25);

  svg.append("g")
    .attr("class", "eje")
    .attr("transform", `translate(0,${margen.top})`)
    .call(d3.axisTop(x).ticks(6).tickFormat(d => d + "%"));

  svg.append("g")
    .attr("class", "eje")
    .attr("transform", `translate(${margen.left},0)`)
    .call(d3.axisLeft(y).tickSize(0));

  const cambioCiudad = datos[0] ? datos[0].cambio_pct_ciudad : 0;
  svg.append("line")
    .attr("x1", x(cambioCiudad)).attr("x2", x(cambioCiudad))
    .attr("y1", margen.top).attr("y2", alto - margen.bottom)
    .attr("class", "grid-line");

  svg.append("g")
    .selectAll("rect")
    .data(datos)
    .join("rect")
    .attr("x", d => Math.min(x(0), x(d.cambio_pct)))
    .attr("y", d => y(d.corredor))
    .attr("width", d => Math.abs(x(d.cambio_pct) - x(0)))
    .attr("height", y.bandwidth())
    .attr("fill", d => d.cambio_pct < 0 ? "#4fb6ff" : "#ff5d6c")
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `${d.corredor}<br>antes: ${d.antes} · después: ${d.despues}<br>cambio: ${d.cambio_pct}%`))
    .on("mouseleave", ocultarTooltip);
}

function dibujarTendencia(series) {
  const margen = { top: 20, right: 30, bottom: 30, left: 50 };
  const ancho = 900, alto = 420;
  const svg = d3.select("#tendencia-svg");

  const todosLosAnios = Array.from(new Set(Object.values(series).flat().map(d => d.anio))).sort();
  const x = d3.scalePoint().domain(todosLosAnios).range([margen.left, ancho - margen.right]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(Object.values(series).flat(), d => d.indice) * 1.1])
    .range([alto - margen.bottom, margen.top]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${alto - margen.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y));

  const colores = { TRATAMIENTO: "#ff8a3d", CONTROL: "#5c6b8a" };
  const linea = d3.line().x(d => x(d.anio)).y(d => y(d.indice));

  Object.entries(series).forEach(([grupo, puntos]) => {
    svg.append("path")
      .datum(puntos)
      .attr("fill", "none")
      .attr("stroke", colores[grupo] ?? "#999")
      .attr("stroke-width", 2.5)
      .attr("d", linea);

    svg.append("g")
      .selectAll("circle")
      .data(puntos)
      .join("circle")
      .attr("cx", d => x(d.anio))
      .attr("cy", d => y(d.indice))
      .attr("r", 4)
      .attr("fill", colores[grupo] ?? "#999")
      .on("mousemove", (evento, d) => mostrarTooltip(evento, `${grupo}<br>${d.anio}: índice ${d.indice} (n=${d.n})`))
      .on("mouseleave", ocultarTooltip);
  });

  const leyenda = d3.select("#tendencia-leyenda");
  leyenda.selectAll("div").data(Object.keys(series)).join("div")
    .attr("class", "leyenda-item")
    .html(d => `<span class="leyenda-punto" style="background:${colores[d] ?? "#999"}"></span>${d}`);
}

function dibujarHeatmap(filas) {
  const corredores = Array.from(new Set(filas.map(d => d.corredor)));
  const anios = Array.from(new Set(filas.map(d => d.anio))).sort();
  const margen = { top: 30, right: 20, bottom: 20, left: 180 };
  const ancho = 900, alto = Math.max(260, corredores.length * 26 + margen.top + margen.bottom);
  const svg = d3.select("#heatmap-svg").attr("viewBox", `0 0 ${ancho} ${alto}`);

  const x = d3.scaleBand().domain(anios).range([margen.left, ancho - margen.right]).padding(0.06);
  const y = d3.scaleBand().domain(corredores).range([margen.top, alto - margen.bottom]).padding(0.06);
  const color = d3.scaleSequential(d3.interpolateOranges).domain([0, d3.max(filas, d => d.n)]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${margen.top})`).call(d3.axisTop(x).tickFormat(d3.format("d")));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y).tickSize(0));

  svg.append("g")
    .selectAll("rect")
    .data(filas)
    .join("rect")
    .attr("x", d => x(d.anio))
    .attr("y", d => y(d.corredor))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", d => color(d.n))
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `${d.corredor}<br>${d.anio}: ${d.n} siniestros`))
    .on("mouseleave", ocultarTooltip);
}

function dibujarEfecto(resultados) {
  const claves = Object.keys(resultados);
  const margen = { top: 20, right: 30, bottom: 30, left: 130 };
  const ancho = 900, alto = 320;
  const svg = d3.select("#efecto-svg");

  const y = d3.scaleBand().domain(claves).range([margen.top, alto - margen.bottom]).padding(0.35);
  const valores = claves.map(k => resultados[k]).filter(v => v.razon_tasa !== null);
  const x = d3.scaleLinear()
    .domain([0, Math.max(1.3, d3.max(valores, d => d.ci95_alto ?? d.razon_tasa))]).nice()
    .range([margen.left, ancho - margen.right]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${alto - margen.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y).tickSize(0));

  svg.append("line")
    .attr("x1", x(1)).attr("x2", x(1))
    .attr("y1", margen.top).attr("y2", alto - margen.bottom)
    .attr("class", "grid-line");

  claves.forEach(clave => {
    const v = resultados[clave];
    if (v.razon_tasa === null) return;
    const cy = y(clave) + y.bandwidth() / 2;
    svg.append("line")
      .attr("x1", x(v.ci95_bajo)).attr("x2", x(v.ci95_alto))
      .attr("y1", cy).attr("y2", cy)
      .attr("stroke", "#4fb6ff").attr("stroke-width", 2);
    svg.append("circle")
      .attr("cx", x(v.razon_tasa)).attr("cy", cy).attr("r", 6)
      .attr("fill", v.razon_tasa < 1 ? "#4fb6ff" : "#ff5d6c")
      .on("mousemove", (evento) => mostrarTooltip(evento, `${clave}<br>razón de tasa: ${v.razon_tasa}<br>IC95%: [${v.ci95_bajo}, ${v.ci95_alto}]`))
      .on("mouseleave", ocultarTooltip);
  });
}

function dibujarExposicion(filas) {
  const margen = { top: 20, right: 30, bottom: 40, left: 50 };
  const ancho = 900, alto = 420;
  const svg = d3.select("#exposicion-svg");

  const x = d3.scaleLinear().domain([0, d3.max(filas, d => d.n_camaras) + 0.5]).range([margen.left, ancho - margen.right]);
  const y = d3.scaleLinear().domain(d3.extent(filas, d => d.delta_p85)).nice().range([alto - margen.bottom, margen.top]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${alto - margen.bottom})`).call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y));

  svg.append("line")
    .attr("x1", margen.left).attr("x2", ancho - margen.right)
    .attr("y1", y(0)).attr("y2", y(0))
    .attr("class", "grid-line");

  svg.append("g")
    .selectAll("circle")
    .data(filas)
    .join("circle")
    .attr("cx", d => x(d.n_camaras) + (Math.random() - 0.5) * 10)
    .attr("cy", d => y(d.delta_p85))
    .attr("r", 3.5)
    .attr("fill", d => d.con_camara ? "#ff8a3d" : "#5c6b8a")
    .attr("opacity", 0.75)
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `tramo ${d.tid}<br>cámaras: ${d.n_camaras}<br>Δ p85: ${d.delta_p85} km/h`))
    .on("mouseleave", ocultarTooltip);
}

function dibujarGravedad(filas) {
  const franjas = ["MADRUGADA", "PICO_MANANA", "VALLE", "PICO_TARDE", "NOCHE"];
  const gravedades = ["CON MUERTOS", "CON HERIDOS", "SOLO DANOS"];
  const margen = { top: 20, right: 30, bottom: 40, left: 50 };
  const ancho = 900, alto = 420;
  const svg = d3.select("#gravedad-svg");

  const x0 = d3.scaleBand().domain(franjas).range([margen.left, ancho - margen.right]).padding(0.25);
  const x1 = d3.scaleBand().domain(gravedades).range([0, x0.bandwidth()]).padding(0.1);
  const y = d3.scaleLinear().domain([0, d3.max(filas, d => d.pct) * 1.1]).range([alto - margen.bottom, margen.top]);
  const color = d3.scaleOrdinal().domain(gravedades).range(["#ff5d6c", "#ff8a3d", "#4fb6ff"]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${alto - margen.bottom})`).call(d3.axisBottom(x0));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y).tickFormat(d => d + "%"));

  svg.append("g")
    .selectAll("g")
    .data(franjas)
    .join("g")
    .attr("transform", d => `translate(${x0(d)},0)`)
    .selectAll("rect")
    .data(franja => gravedades.map(g => {
      const fila = filas.find(f => f.franja === franja && f.gravedad === g);
      return { franja, gravedad: g, pct: fila ? fila.pct : 0, n: fila ? fila.n : 0 };
    }))
    .join("rect")
    .attr("x", d => x1(d.gravedad))
    .attr("y", d => y(d.pct))
    .attr("width", x1.bandwidth())
    .attr("height", d => y(0) - y(d.pct))
    .attr("fill", d => color(d.gravedad))
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `${d.franja}<br>${d.gravedad}: ${d.pct}% (n=${d.n})`))
    .on("mouseleave", ocultarTooltip);

  const leyenda = d3.select("#gravedad-leyenda");
  leyenda.selectAll("div").data(gravedades).join("div")
    .attr("class", "leyenda-item")
    .html(d => `<span class="leyenda-punto" style="background:${color(d)}"></span>${d}`);
}

function dibujarCalidad(calidad) {
  const filas = calidad.siniestros_por_anio;
  const margen = { top: 20, right: 30, bottom: 30, left: 50 };
  const ancho = 900, alto = 320;
  const svg = d3.select("#calidad-svg");

  const x = d3.scaleBand().domain(filas.map(d => d.anio)).range([margen.left, ancho - margen.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, 100]).range([alto - margen.bottom, margen.top]);

  svg.append("g").attr("class", "eje").attr("transform", `translate(0,${alto - margen.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));
  svg.append("g").attr("class", "eje").attr("transform", `translate(${margen.left},0)`).call(d3.axisLeft(y).tickFormat(d => d + "%"));

  svg.append("g")
    .selectAll("rect")
    .data(filas)
    .join("rect")
    .attr("x", d => x(d.anio))
    .attr("y", d => y(d.pct_geocodificado))
    .attr("width", x.bandwidth())
    .attr("height", d => y(0) - y(d.pct_geocodificado))
    .attr("fill", "#4fb6ff")
    .on("mousemove", (evento, d) => mostrarTooltip(evento, `${d.anio}<br>geocodificado: ${d.pct_geocodificado}%<br>total siniestros: ${d.total}`))
    .on("mouseleave", ocultarTooltip);
}

Promise.all([
  d3.json("data/camaras.json"),
  d3.json("data/tramos.geojson"),
  d3.json("data/sitios.json"),
  d3.json("data/corredores_ranking.json"),
  d3.json("data/tendencia.json"),
  d3.json("data/heatmap.json"),
  d3.json("data/efecto_promedio.json"),
  d3.json("data/exposicion_camaras.json"),
  d3.json("data/gravedad_franja.json"),
  d3.json("data/calidad.json"),
]).then(([camaras, tramosGeo, sitios, ranking, tendencia, heatmap, efecto, exposicion, gravedad, calidad]) => {
  dibujarHero(tramosGeo);
  initHistoria(tramosGeo, camaras, sitios, ranking, efecto);
  dibujarMapa(camaras, tramosGeo);
  dibujarRanking(ranking);
  dibujarTendencia(tendencia);
  dibujarHeatmap(heatmap);
  dibujarEfecto(efecto);
  dibujarExposicion(exposicion);
  dibujarGravedad(gravedad);
  dibujarCalidad(calidad);
});

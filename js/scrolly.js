function initHistoria(tramosGeo, camaras, sitios, ranking, efecto) {
  const svg = d3.select("#historia-svg");
  const ancho = 960, alto = 760;
  const proyeccion = d3.geoMercator().fitSize([ancho - 20, alto - 20], tramosGeo);
  const camino = d3.geoPath(proyeccion);

  const topCorredores = ranking
    .filter(d => d.cambio_pct !== null)
    .sort((a, b) => a.cambio_pct - b.cambio_pct)
    .slice(0, 5);

  const nombresTop = new Set(topCorredores.map(d => d.corredor));
  const tidsTop = new Set();
  sitios.forEach(s => {
    if (nombresTop.has(s.corredor) && s.tids) {
      s.tids.split(";").forEach(t => tidsTop.add(Number(t)));
    }
  });

  document.getElementById("top-corredores").textContent = topCorredores.map(d => d.corredor).join(", ");
  const reduccion = Math.round((1 - efecto.TODAS.razon_tasa) * 100);
  document.getElementById("efecto-reduccion").textContent = reduccion + "%";

  const capaTramos = svg.append("g")
    .attr("transform", "translate(10,10)")
    .selectAll("path")
    .data(tramosGeo.features)
    .join("path")
    .attr("d", camino)
    .attr("fill", "none")
    .attr("stroke-width", 1)
    .attr("stroke", "#2a3346")
    .attr("opacity", 0.5);

  const capaCamaras = svg.append("g")
    .attr("transform", "translate(10,10)")
    .selectAll("circle")
    .data(camaras)
    .join("circle")
    .attr("cx", d => proyeccion([d.lon, d.lat])[0])
    .attr("cy", d => proyeccion([d.lon, d.lat])[1])
    .attr("r", 3)
    .attr("fill", "#4fb6ff")
    .attr("opacity", 0);

  const leyenda = d3.select("#historia-leyenda");

  function actualizarLeyenda(items) {
    leyenda.selectAll("div").data(items).join("div")
      .attr("class", "leyenda-item")
      .html(d => `<span class="leyenda-punto" style="background:${d[0]}"></span>${d[1]}`);
  }

  function renderPaso(indice) {
    if (indice === 0) {
      capaTramos.transition().duration(400)
        .attr("stroke", "#2a3346").attr("stroke-width", 1).attr("opacity", 0.5);
      capaCamaras.transition().duration(300).attr("opacity", 0);
      actualizarLeyenda([["#2a3346", "868 tramos Bitcarrier"]]);
    } else if (indice === 1) {
      capaTramos.transition().duration(400)
        .attr("stroke", "#2a3346").attr("stroke-width", 1).attr("opacity", 0.5);
      capaCamaras.transition().duration(300).attr("opacity", 1);
      actualizarLeyenda([["#2a3346", "tramos"], ["#4fb6ff", "cámaras"]]);
    } else if (indice === 2 || indice === 4) {
      capaTramos.transition().duration(400)
        .attr("stroke", d => d.properties.con_camara ? "#ff8a3d" : "#2a3346")
        .attr("stroke-width", d => d.properties.con_camara ? 2 : 1)
        .attr("opacity", d => d.properties.con_camara ? 0.95 : 0.35);
      capaCamaras.transition().duration(300).attr("opacity", 1);
      actualizarLeyenda([["#ff8a3d", "tratamiento (≤ 50 m)"], ["#2a3346", "control"]]);
    } else if (indice === 3) {
      capaTramos.transition().duration(400)
        .attr("stroke", d => tidsTop.has(d.properties.tid) ? "#ff5d6c" : (d.properties.con_camara ? "#ff8a3d" : "#2a3346"))
        .attr("stroke-width", d => tidsTop.has(d.properties.tid) ? 2.5 : (d.properties.con_camara ? 2 : 1))
        .attr("opacity", d => tidsTop.has(d.properties.tid) ? 1 : (d.properties.con_camara ? 0.5 : 0.3));
      capaCamaras.transition().duration(300).attr("opacity", 1);
      actualizarLeyenda([["#ff5d6c", "mayor caída de siniestros"], ["#ff8a3d", "resto con cámara"]]);
    }
  }

  renderPaso(0);

  const pasos = document.querySelectorAll(".paso");
  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) {
        const indice = Number(entrada.target.dataset.paso);
        pasos.forEach(p => p.classList.remove("activo"));
        entrada.target.classList.add("activo");
        renderPaso(indice);
      }
    });
  }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

  pasos.forEach(p => observador.observe(p));
}

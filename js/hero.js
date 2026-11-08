function dibujarHero(tramosGeo) {
  const canvas = document.getElementById("hero-canvas");
  const contexto = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  function redibujar() {
    const ancho = canvas.clientWidth;
    const alto = canvas.clientHeight;
    canvas.width = ancho * dpr;
    canvas.height = alto * dpr;
    contexto.setTransform(dpr, 0, 0, dpr, 0, 0);
    contexto.clearRect(0, 0, ancho, alto);
    contexto.translate(-ancho * 0.12, -alto * 0.08);

    const proyeccion = d3.geoMercator().fitSize([ancho * 1.25, alto * 1.25], tramosGeo);
    const camino = d3.geoPath(proyeccion, contexto);

    contexto.lineWidth = 1;
    contexto.strokeStyle = "rgba(79,182,255,0.22)";
    contexto.beginPath();
    camino(tramosGeo);
    contexto.stroke();
  }

  redibujar();
  window.addEventListener("resize", redibujar);
}

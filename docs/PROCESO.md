# Limpieza y construcción de los datos

## 1. Fuentes

- **Cámaras Salvavidas Bogotá** — `Camaras_Salvavidas_Bogota.geojson`, 92 cámaras puntuales, agrupadas en 40 sitios de intersección (el prefijo antes de la barra en `ID_CÁMARA`, p. ej. `DEI-001/CAM-01` → sitio `DEI-001`).
- **Vectores Bitcarrier** — `Vectores Bitcarrier.geojson`, 868 tramos de sensores de velocidad (`MultiLineString`), identificados por `TID`.
- **Velocidad Bitcarrier** — 46 archivos CSV mensuales (2019: 11, 2020: 11, 2021: 12, 2022: 12) con velocidad promedio por tramo en intervalos de 15 minutos.
- **SIGAT / siniestralidad** — un archivo por año (`Base_2018.xlsx` y `SIGAT_ANUARIO_{2019,2020,2021,2022}.xlsx`), con esquema de columnas distinto cada año.
- Enlaces exactos en `datasets.pdf`, dentro de la carpeta de cámaras.

Las tablas limpias se construyen directamente desde estos archivos crudos, no desde `datos_limpios/`.

## 2. Problemas de los datos y cómo se trataron

- **Enero 2019 y diciembre 2022 no existen** en los CSV de velocidad — se documentan como huecos, no se interpolan.
- **`Velocidades_Bitcarrier_Septiembre_2020.csv` está guardado dentro de la carpeta `2022/`**, pero su contenido (`AÑO=2020`, `MES=September`) es real de 2020. El pipeline agrupa por los campos `AÑO`/`MES` que vienen dentro de cada fila, nunca por la carpeta o el nombre del archivo, así que este archivo cae donde le corresponde sin tratamiento especial.
- **Julio de 2019 está duplicado** (el archivo pesa el doble de lo esperado). Antes de agregar, se aplica `SELECT DISTINCT` sobre las columnas clave (`tid, anio, mes_nombre, hora, dia_semana, vel`), lo que colapsa automáticamente cualquier fila repetida, venga de un archivo duplicado o no.
- **Filas corruptas** en junio/noviembre de 2019 y mayo de 2020: se leen todos los CSV con `read_csv(..., ignore_errors=true)` de DuckDB, y cualquier valor no convertible se descarta con `TRY_CAST` (queda `NULL` y se filtra).
- **Velocidades fuera de rango**: solo se conservan lecturas con `0 < VEL_PROMEDIO <= 120` km/h.
- **El esquema de los siniestros cambia cada año** (nombres de columna, si trae coordenadas, si trae mortalidad a 30 días). `scripts/build_siniestros.py` tiene una función por año/formato que mapea cada esquema a un conjunto común de columnas, en vez de asumir que todos los archivos tienen las mismas columnas.
- **Solo 2022 trae latitud/longitud reales** en los siniestros. Para 2018–2021 no se inventan coordenadas: se usa una coincidencia de texto entre la dirección del siniestro y el nombre del corredor de alguna cámara (`corredor_nombre`), que es una aproximación a nivel de corredor, no de intersección exacta.
- **Las banderas `CON_*`** (moto, peatón, velocidad, etc.) llegan como `SI`/vacío en 2020–2022 en vez de `SI`/`NO`; se normalizan a `SI`/`NO` explícito.
- **Gravedad**: en 2020 y 2021 la columna `GravedadNombre` trae en realidad el código numérico (1/2/3) en vez de texto; se mapea con el diccionario de la propia hoja `DICCIONARIO` (1=Con Muertos, 2=Con Heridos, 3=Solo Daños).
- **6 tramos de `Vectores Bitcarrier.geojson` traen geometría basura**: `TID` 41, 42, 156, 157, 158 y 159 tienen coordenadas `[0,0]`–`[1,1]`, ya así en el archivo crudo. Esos puntos quedan fuera de Bogotá y rompen la proyección del mapa si se dejan pasar. Se descartan si ningún punto cae dentro de un rango razonable de longitud/latitud para Bogotá.

## 3. Unión cámaras ↔ tramos (`scripts/build_sitios_tramos.py`)

Para cada una de las 92 cámaras se calcula la distancia mínima punto-a-segmento contra los 862 tramos de Bitcarrier con geometría válida (proyección local equirrectangular centrada en Bogotá, ~4.65°N). Un tramo se marca `con_camara = true` si tiene al menos una cámara a 50 m o menos; estos tramos son el grupo de tratamiento, el resto es el grupo de control. La fecha de activación de cada cámara se extrae con una expresión regular sobre el texto de la resolución de la Secretaría de Movilidad (`NÚMERO_DE`, p. ej. "Diciembre 13 de 2019").

Salidas: `data/clean/camaras.csv`, `data/clean/tramos.csv`, `data/clean/sitios.csv`, y para el tablero `data/camaras.json`, `data/tramos.json`, `data/tramos.geojson`, `data/sitios.json`.

## 4. Siniestros y actores (`scripts/build_siniestros.py`)

Cada siniestro recibe un `periodo` según su fecha:

- `1_ANTES`: antes del 1 de noviembre de 2019.
- `2_INSTALACION`: 1 nov. 2019 – 24 mar. 2020 (instalación progresiva de cámaras).
- `3_COVID_2020`: 25 mar. – 31 dic. 2020 (cuarentena, movilidad atípica).
- `4_DESPUES`: desde el 1 de enero de 2021.

La comparación antes/después del efecto de las cámaras usa solo `1_ANTES` y `4_DESPUES`, dejando fuera los periodos de transición e cuarentena para no mezclar efectos.

Salidas: `data/clean/siniestros.csv` (148 943 filas) y `data/clean/actores.csv` (322 657 filas) — una fila por persona involucrada (conductor, peatón, ciclista, pasajero).

## 5. Velocidad (`scripts/build_velocidades.py`)

Los 46 CSV crudos (≈15.7 GB) se leen con DuckDB directamente desde las dos carpetas de velocidades, sin copiarlos. Después de deduplicar y filtrar (sección 2), se agregan a nivel tramo × año × mes × franja horaria × tipo de día (`SEMANA`/`FINDE`), calculando lecturas, media, mediana y percentil 85. Las franjas horarias son un criterio propio (madrugada, pico mañana, valle, pico tarde, noche), no un valor que venga en los datos crudos.

Salida: `data/clean/velocidad_mensual.csv` (786 044 filas).

## 6. Geocodificación propia (`scripts/direcciones.py`, `scripts/geocodificar.py`, `scripts/build_geocodificacion.py`)

Solo 2022 trae latitud/longitud reales en los siniestros. Se investigó usar el geocodificador oficial de Bogotá (IDECA/Catastro, corre sobre `serviciosgis.catastrobogota.gov.co`) en vez de inventar uno — resultó requerir token institucional sin autorregistro público, así que no se pudo usar. En su lugar se construyó un geocodificador propio, desde cero:

1. **Parseo de direcciones** (`direcciones.py`): las direcciones de siniestros son cruces tipo `VIA1 - VIA2 código` (p. ej. `KR 60 - CL 44 02`). Se parsean los dos tramos de vía (tipo CL/KR/AK/AC/AV/DG/TV + número + letra + sufijo sur) a una clave normalizada. Cubre el 99,0% de las 148.943 direcciones; el resto son vías rurales tipo `VIA CHOACHI KM 12` que no tienen formato de cruce y se descartan.
2. **Referencia**: los 25.447 siniestros de 2022 (con coordenada real y dirección en el mismo formato) sirven de referencia. Se indexan por cruce exacto (ambas vías) y por vía individual (para interpolar cuando no hay coincidencia exacta de cruce).
3. **Geocodificación**: para un siniestro sin coordenada, si su cruce exacto aparece en la referencia, se usa el promedio de esos puntos. Si no, se interpola por la vía principal usando los 3 puntos de referencia más cercanos en número de la vía que cruza. Si ninguna de las dos vías tiene referencia, no se inventa coordenada.
4. **Validación honesta** (`data/calidad_geocod.json`): split-half sobre los propios 25.447 registros de 2022 — se parte por la mitad, se geocodifica la mitad de prueba usando solo la otra mitad como referencia, y se compara contra la coordenada real. Resultado real (no estimado): **error mediano de 170 m**, 35,9% de los puntos a menos de 100 m, 58,3% a menos de 250 m, 67,9% a menos de 500 m, y 2,8% sin ninguna referencia para geocodificar. Es peor que el 64 m que reporta el repo original — es el costo real de no tener acceso al geocodificador oficial.
5. Con esa referencia completa de 2022, se geocodifican los 123.496 siniestros de 2018–2021; 148.255 de los 148.943 totales (99,5%) terminan con alguna coordenada (real o estimada) y distancia a la cámara más cercana (`dist_camara_m` en `data/clean/siniestros.csv`).

## 7. Efecto de las cámaras (`scripts/build_efecto.py`)

El grupo de tratamiento para este modelo es el conjunto de siniestros a **250 m o menos** de la cámara más cercana (`dist_camara_m`), usando la coordenada real en 2022 y la geocodificada en 2018–2021; el resto es el control. Se eligió 250 m y no 150 m porque el error mediano del geocodificador (170 m) ya es mayor que un radio de 150 m, lo que haría esa clasificación poco confiable. `data/efecto_por_radio.json` muestra el mismo modelo a 150, 250 y 500 m para ver qué tan sensible es el resultado al radio elegido. Se construye un panel mensual de conteos por grupo, y se ajusta una regresión de Poisson:

```
conteo ~ C(mes) + tratamiento * despues
```

con efectos fijos por mes (para controlar estacionalidad) y una interacción tratamiento×después, que es el estimador de diferencias en diferencias. El intervalo de confianza del 95% se calcula por bootstrap (300 remuestreos con reemplazo a nivel de siniestro, reconstruyendo el panel y reajustando el modelo en cada iteración). Se corre una vez para todos los siniestros y una vez por cada nivel de gravedad.

Resultado a 250 m: razón de tasa 1,040 (IC95% 0,995–1,086) para todos los siniestros — no significativo, cruza 1. Con heridos 1,040 (0,964–1,121), con muertos 1,083 (0,686–1,390), solo daños 1,057 (1,000–1,119). A 150 m da 1,110 (1,050–1,182, sí significativo) y a 500 m 1,042 (1,013–1,075). Son números reales de esta reconstrucción, no los del repo original ni los del corredor por texto que se usaba antes en este mismo repo — cambia el resultado según qué tan preciso es el vínculo siniestro↔cámara, y ninguno de los tres debería leerse como la cifra "correcta" sin más contexto.

La misma función genera además: `data/tendencia.json` (índice anual base 100, tratamiento vs. control por distancia, con series separadas para `TODAS` y cada gravedad — ver sección 13), `data/corredores_ranking.json` y `data/heatmap.json` (agrupan por el corredor del sitio más cercano entre los siniestros a 250 m o menos, usando `sitio_cercano`, no coincidencia de texto; ambos incluyen una fila/columna `"Resto de la ciudad (control)"` con `es_control: true` para poder comparar contra el control en el mismo gráfico), `data/por_gravedad.json` (lo mismo que `corredores_ranking.json`/`heatmap.json`, pero separado por gravedad, para el filtro del explorador), `data/velocidad_gravedad.json` (gravedad cruzada con tercil de velocidad del tramo, por franja horaria — ver sección 13) y `data/calidad.json` (cobertura real/geocodificada y % dentro de 250 m por año).

## 8. Exposición a cámaras y velocidad (`scripts/build_exposicion.py`)

Por tramo de sensor: número de cámaras cercanas (`n_camaras`) vs. cambio en la velocidad p85 entre el periodo `1_ANTES` y el periodo `4_DESPUES` (promedio ponderado por número de lecturas). Se calcula una vez con todas las lecturas (`TODAS`) y una vez por cada franja horaria (`MADRUGADA`, `PICO_MANANA`, `VALLE`, `PICO_TARDE`, `NOCHE`), para el selector de franja del tablero (sección 13). Salida: `data/exposicion_camaras.json`, un objeto con una lista de tramos por cada una de esas seis claves.

## 9. Tablero (`index.html`, `css/styles.css`, `js/app.js`)

Sitio estático, sin build ni framework. Toda visualización se dibuja con **D3.js v7** (cargado por CDN) — mapa de cámaras y tramos, tendencia anual (con selector de gravedad), gravedad según velocidad del tramo por franja horaria, cuándo se instalaron las cámaras, mapa de calor corredor×año, gráfico de efecto (forest plot), explorador con ranking de corredores, dispersión de exposición a cámaras y velocidad (con selector de franja). El tablero solo lee los archivos `data/*.json` y `data/tramos.geojson` ya calculados; no vuelve a tocar los datos crudos.

El orden de las secciones va de lo general a lo específico (feedback de clase, sección 13): primero la historia que da el contexto, después patrones de toda la ciudad (tendencia, gravedad, instalación), después el detalle por corredor (mapa de calor, efecto estimado) y por último lo más granular e interactivo (explorador con filtros, velocidad por tramo).

## 10. Diseño visual

El tablero sigue el mismo sistema visual del repositorio original `cameras-salvavidas` (tipografía, paneles de vidrio esmerilado, mapa fijo con historia que se desliza, explorador con zoom).

## 11. Cómo correr todo de nuevo

```
python3 -m venv .venv
.venv/bin/pip install duckdb pandas numpy scipy openpyxl shapely statsmodels
.venv/bin/python3 scripts/run_pipeline.py
```

Las rutas a las carpetas crudas se configuran en `scripts/config.py` (con valores por defecto en `~/Downloads`), o por variables de entorno — ver `scripts/README.md`. `data/clean/` (las tablas intermedias) no se versiona — se regenera corriendo el pipeline; solo los `data/*.json` y `data/tramos.geojson` que consume el tablero quedan en el repositorio.

## 12. Limitaciones

- La geocodificación propia (sección 6) tiene un error mediano real de 170 m, medido por validación cruzada, no supuesto. A un radio de tratamiento de 250 m eso es ruido significativo: siniestros que en realidad están cerca pueden clasificarse como lejos, y viceversa. El resultado del modelo de efecto depende de esto más de lo que parece al mirar solo el número final.
- `corredores_ranking.json` y `heatmap.json` agrupan por corredor (a través del sitio más cercano), no por cruce o punto individual, aunque la clasificación de cercanía (250 m) ya es por distancia real/geocodificada, igual que el modelo de efecto.
- 2,8% de los siniestros 2018–2021 no tienen ninguna vía de referencia en 2022 y quedan sin coordenada ni distancia a cámara.
- La velocidad es velocidad de recorrido entre sensores Bitcarrier, no velocidad puntual medida por la cámara.
- **La columna `clase` (tipo de siniestro) cambia de taxonomía según el año**: 2018 usa `Choque`/`Atropello`/`Volcamiento`/`Caída de ocupante`/`Otro`; 2019 y 2022 usan otro vocabulario (`Vehiculo`/`Vehículo`/`Objeto Fijo`/`Semoviente`/`Tren`) que no incluye `Choque` ni `Atropello` como tales; 2020 y 2021 traen solo un código numérico sin diccionario de `clase` disponible. Por eso el tablero no filtra por `clase` — un filtro así dejaría el periodo "después" (2021–2022) prácticamente vacío para casi cualquier tipo elegido, no porque esos siniestros hayan desaparecido sino porque ese año no se etiquetan así. El filtro por gravedad (sección 13) no tiene este problema: `gravedad` se calcula igual en todos los años.

## 13. Cambios por retroalimentación de clase

Después de una presentación en clase se recibió retroalimentación puntual, que se aplicó así:

- **Orden general → específico**: se reordenaron las secciones (ver sección 9) para empezar por los patrones generales de toda la ciudad y terminar en lo más granular e interactivo.
- **Degradados en los mapas**: la densidad de cámaras por km y el cambio por corredor/sitio ya no se pintan en 2–3 colores discretos; usan una escala continua (`d3.scaleSequential`/`d3.scaleLinear` interpolando entre los colores de la paleta) en el mapa de portada, el mapa de la historia y el explorador, con una leyenda en forma de barra de degradado.
- **Tiempo de instalación de las cámaras**: primero se hizo como una sección aparte, con una gráfica de escalones (cámaras activas acumuladas en el tiempo). Se reemplazó después (ver último punto de esta sección) por una escena dentro del mapa de la historia, porque como gráfica suelta no decía nada sobre si eso afectó o no los siniestros.
- **Zonas de control en todas las visualizaciones**: `corredores_ranking.json` y `heatmap.json` (sección 7) ahora incluyen una fila `"Resto de la ciudad (control)"`; el mapa de calor la dibuja aparte, con estilo distinto, debajo de los corredores; el gráfico de embudo del explorador ya traía el control implícito en el eje (0% = igual que la ciudad) y ahora además dibuja la línea punteada con la etiqueta "nivel de la ciudad" explícitamente.
- **Filtro por gravedad**: nuevo selector en el explorador (con muertos / con heridos / solo daños), alimentado por `data/por_gravedad.json` (`scripts/build_efecto.py`, función `construir_por_gravedad`). Se probó primero con `clase` (tipo de siniestro: choque/atropello/volcamiento), pero esa columna tiene el problema de taxonomía descrito arriba y no daba una comparación confiable; `gravedad` ya se calcula de forma consistente en todos los años (se usa en el modelo de efecto y en la gravedad por franja horaria), así que es la columna correcta para este filtro.
- **Selector de gravedad en la tendencia anual**: `construir_tendencia` ahora calcula la serie TRATAMIENTO/CONTROL una vez para todos los siniestros (`TODAS`) y una vez por cada gravedad, cada una con su propio índice base 100 (indexado a su propio primer año, no al de `TODAS`). El selector `#tgrav` en el tablero cambia cuál de esas series se dibuja.
- **Selector de franja horaria en la exposición a cámaras**: igual que arriba pero en `scripts/build_exposicion.py` — `p85_antes`/`p85_despues`/`delta_p85` por tramo se calculan para `TODAS` las lecturas y para cada una de las 5 franjas (`franja` ya viene en `velocidad_mensual.csv`). El selector `#chips` cambia qué franja se grafica.
- **Rebautizado "Gravedad por franja horaria" a "Gravedad según la velocidad del tramo, por franja horaria"**: ya no es solo % de gravedad por franja (ese archivo, `gravedad_franja.json`, se eliminó); ahora cruza gravedad con **tercil de velocidad del tramo** (lento/medio/rápido) dentro de cada franja — igual que el repo original, pero reconstruido desde cero porque nuestro modelo no tiene geocodificación punto a punto para todos los años. Método (`construir_velocidad_gravedad` en `scripts/build_efecto.py`): para cada franja, se promedia `vel_p85` por tramo usando solo el periodo `1_ANTES` (velocidad "de referencia", antes de que las cámaras pudieran cambiar el comportamiento), y se parte esa distribución de tramos en 3 terciles con `pandas.quantile`. Cada siniestro a 250 m o menos de una cámara (mismo grupo de tratamiento del modelo de efecto) se asocia al tramo de su sitio más cercano (primer `tid` en `sitios.csv`) y hereda el tercil de velocidad de ese tramo en su franja. De los 9.252 siniestros candidatos, 9.047 (97,8 %) se lograron asociar a un tramo con tercil calculado; el resto se descarta, no se inventa. Salida: `data/velocidad_gravedad.json` con `celdas` (una fila por franja×tercil: `n`, `pct_muertos`, `pct_heridos`), más `n_candidatos`/`n_unidos`/`pct_unidos`. El selector `#vchips` cambia entre ver % con muertos o % con heridos. A diferencia de la versión anterior de esta sección, el alcance ya no es "toda la ciudad" sino solo siniestros cerca de una cámara, porque solo para esos hay un tramo específico al cual asociar una velocidad — el texto del tablero se actualizó para decirlo.
- **Resaltado cruzado mapa↔embudo**: pasar el mouse por un punto del gráfico de embudo (significancia del cambio) resalta los sitios de ese corredor en el mapa del explorador, y viceversa — antes cada uno se resaltaba por separado.
- **Detalle al hacer clic en un sitio del mapa**: se había perdido en el rediseño visual (el CSS ya existía, copiado del original, pero nunca se conectó). Clic en un círculo del mapa muestra una tarjeta con el corredor, siniestros antes/después, número de cámaras, fecha de activación, y un enlace directo a Street View (`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=lat,lon`).
- **La instalación de las cámaras se movió al mapa de la historia**: la sección aparte con la gráfica de escalones se quitó; ahora es una escena más del scrollytelling (la segunda, "2 de 5"). Al entrar en esa escena, los 40 cruces aparecen en el mapa en el orden real en que se activaron sus cámaras (`fecha_activacion` en `data/sitios.json`, que ya traía esa columna — no hizo falta ningún archivo nuevo), agrupados en las 5 tandas reales de activación (19 nov 2019, 13 dic, 26 dic, 20 ene 2020, 27 mar 2020), con un contador de fecha y cámaras activas superpuesto en el mapa. La idea es que se vea directamente ahí, y no en una gráfica aislada, que casi todas las cámaras ya estaban prendidas para cuando empieza la caída de siniestros de 2020 que se explica en la escena siguiente — la instalación deja de ser un dato suelto y pasa a ser parte de la misma historia antes/después. `data/camaras.json` (el detalle por cámara individual, no por cruce) dejó de cargarse en el tablero porque ya no lo usa nada; sigue generándose en el pipeline como parte de la trazabilidad de datos.
- **Corte de fecha manual en el explorador**: la animación de instalación en el mapa de la historia es narrativa (se reproduce sola, no se controla). Para poder manipular la fecha de verdad se agregó un segundo modo al explorador, junto a los filtros de corredor y gravedad: "Corte manual". Nuevo archivo `data/siniestros_mensual.json` (`construir_siniestros_mensual` en `scripts/build_efecto.py`), con el conteo mensual de siniestros por corredor (o control) y por gravedad, de enero de 2018 a diciembre de 2022 — 76 filas (19 corredores/control × 4 gravedades) × 60 meses, construido con el mismo `con_corredor()` que ya usan el ranking y el heatmap. Con el slider, "antes" y "después" se recalculan en el navegador sumando esa serie a cada lado de la fecha elegida, sin pasar por el servidor. A diferencia del modelo de efecto (diferencias en diferencias, sección 5), este corte no excluye el periodo de instalación (nov 2019–mar 2020) ni el de cuarentena de 2020 — es una comparación simple antes/después del punto que se elija, pensada para explorar, no para citar como el resultado del análisis; el tablero lo aclara en una nota junto al control. En el modo por defecto ("Fecha real de cada cámara") el explorador sigue usando `corredores_ranking.json`/`por_gravedad.json` exactamente como antes.

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

## 3. Unión cámaras ↔ tramos (`scripts/build_sitios_tramos.py`)

Para cada una de las 92 cámaras se calcula la distancia mínima punto-a-segmento contra los 868 tramos de Bitcarrier (proyección local equirrectangular centrada en Bogotá, ~4.65°N). Un tramo se marca `con_camara = true` si tiene al menos una cámara a 50 m o menos; estos tramos son el grupo de tratamiento, el resto es el grupo de control. La fecha de activación de cada cámara se extrae con una expresión regular sobre el texto de la resolución de la Secretaría de Movilidad (`NÚMERO_DE`, p. ej. "Diciembre 13 de 2019").

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

## 6. Efecto de las cámaras (`scripts/build_efecto.py`)

El grupo de tratamiento para este modelo es el conjunto de siniestros cuya dirección coincide con el nombre de un corredor con cámara (`corredor_camara_texto = SI`); el resto de la ciudad es el control. Se construye un panel mensual de conteos por grupo, y se ajusta una regresión de Poisson:

```
conteo ~ C(mes) + tratamiento * despues
```

con efectos fijos por mes (para controlar estacionalidad) y una interacción tratamiento×después, que es el estimador de diferencias en diferencias. El intervalo de confianza del 95% se calcula por bootstrap (300 remuestreos con reemplazo a nivel de siniestro, reconstruyendo el panel y reajustando el modelo en cada iteración). Se corre una vez para todos los siniestros y una vez por cada nivel de gravedad.

La misma función genera además: `data/tendencia.json` (índice anual base 100, tratamiento vs. control), `data/corredores_ranking.json` (cambio % de siniestros antes/después por corredor, contra el cambio promedio de la ciudad), `data/heatmap.json` (siniestros por corredor × año), `data/gravedad_franja.json` (% de siniestros por gravedad dentro de cada franja horaria, usando la hora propia de cada siniestro) y `data/calidad.json` (cobertura de geocodificación y de coincidencia de corredor por año).

## 7. Exposición a cámaras y velocidad (`scripts/build_exposicion.py`)

Por tramo de sensor: número de cámaras cercanas (`n_camaras`) vs. cambio en la velocidad p85 entre el periodo `1_ANTES` y el periodo `4_DESPUES` (promedio ponderado por número de lecturas). Salida: `data/exposicion_camaras.json`.

## 8. Tablero (`index.html`, `css/styles.css`, `js/app.js`)

Sitio estático, sin build ni framework. Toda visualización se dibuja con **D3.js v7** (cargado por CDN) — mapa de cámaras y tramos, ranking de corredores, tendencia anual, mapa de calor corredor×año, gráfico de efecto (forest plot), dispersión de exposición a cámaras y velocidad, barras de gravedad por franja horaria y un panel de calidad de datos. El tablero solo lee los archivos `data/*.json` y `data/tramos.geojson` ya calculados; no vuelve a tocar los datos crudos.

## 9. Cómo correr todo de nuevo

```
python3 -m venv .venv
.venv/bin/pip install duckdb pandas numpy scipy openpyxl shapely statsmodels
.venv/bin/python3 scripts/run_pipeline.py
```

Las rutas a las carpetas crudas se configuran en `scripts/config.py` (con valores por defecto en `~/Downloads`), o por variables de entorno — ver `scripts/README.md`. `data/clean/` (las tablas intermedias) no se versiona — se regenera corriendo el pipeline; solo los `data/*.json` y `data/tramos.geojson` que consume el tablero quedan en el repositorio.

## 10. Limitaciones

- El vínculo entre un siniestro y un corredor con cámara es una coincidencia de texto entre la dirección y el nombre del corredor, no una geocodificación exacta. Por eso el ranking y el mapa de calor trabajan a nivel de **corredor**, no de intersección individual.
- El grupo de "tratamiento" del modelo de diferencias en diferencias es, por la misma razón, un conjunto de corredores con cámara, no un radio físico medido en metros para cada siniestro salvo en 2022 (único año con coordenadas reales).
- La velocidad es velocidad de recorrido entre sensores Bitcarrier, no velocidad puntual medida por la cámara.

Pipeline de datos, de crudo a `data/*.json`.

Requisitos: `python3 -m venv .venv && .venv/bin/pip install duckdb pandas numpy scipy openpyxl shapely statsmodels`

Variables de entorno (opcionales, con valores por defecto en `scripts/config.py`):

- `CAMARAS_SALVAVIDAS_DIR` (por defecto `~/Downloads/Camaras Salvavidas`)
- `VELOCIDADES_2019_2020_DIR` (por defecto `~/Downloads/Velocidades 2019-2020`)
- `VELOCIDADES_2021_2022_DIR` (por defecto `~/Downloads/Velocidades 2021-2022`)

Ejecutar todo: `.venv/bin/python3 scripts/run_pipeline.py`

Orden y salidas, ver `docs/PROCESO.md`.

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

CAMARAS_DIR = Path(os.environ.get("CAMARAS_SALVAVIDAS_DIR", str(Path.home() / "Downloads" / "Camaras Salvavidas")))
VELOCIDADES_2019_2020_DIR = Path(os.environ.get("VELOCIDADES_2019_2020_DIR", str(Path.home() / "Downloads" / "Velocidades 2019-2020")))
VELOCIDADES_2021_2022_DIR = Path(os.environ.get("VELOCIDADES_2021_2022_DIR", str(Path.home() / "Downloads" / "Velocidades 2021-2022")))

ACCIDENTALIDAD_DIR = CAMARAS_DIR / "ACCIDENTALIDAD"
CAMARAS_GEOJSON = CAMARAS_DIR / "Camaras_Salvavidas_Bogota.geojson"
TRAMOS_GEOJSON = CAMARAS_DIR / "Vectores Bitcarrier.geojson"

CLEAN_DIR = REPO_ROOT / "data" / "clean"
DATA_DIR = REPO_ROOT / "data"

CLEAN_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

INICIO_INSTALACION = "2019-11-01"
INICIO_COVID = "2020-03-25"
INICIO_DESPUES = "2021-01-01"

RADIO_CAMARA_M = 50
RADIOS_EFECTO_M = [150, 250, 500]

SEVERIDADES = ["CON MUERTOS", "CON HERIDOS", "SOLO DANOS"]

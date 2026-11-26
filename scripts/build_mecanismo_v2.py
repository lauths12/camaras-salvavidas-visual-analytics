"""Datos extra de la página «Del resultado al mecanismo (v2)» (mecanismo_v2.html).

Solo escribe un archivo nuevo:
  - data/actores_por_sitio.json  (víctimas heridas o muertas por condición, por sitio con cámara)

No toca ningún JSON que ya consuman index.html ni mecanismo.html. Solo usa la librería
estándar (csv), así que no hace falta pandas para correrlo.

Mismas reglas que construir_actores() de build_mecanismo.py:
  - un siniestro es de un sitio si dist_camara_m <= 250 y se asigna a su sitio_cercano;
    el resto (con distancia) es CONTROL;
  - antes = ene.-oct. 2019 (periodo 1_ANTES con anio >= 2019), después = 4_DESPUES (2021-2022);
  - víctimas = personas con gravedad HERIDO o MUERTO, condiciones PEATON, MOTOCICLISTA,
    CICLISTA, PASAJERO, CONDUCTOR.
La suma de todos los sitios debe dar exactamente el grupo CERCA de actores_mecanismo.json,
y el script lo comprueba.
"""
import csv
import json
import sys
from collections import defaultdict
from datetime import date

from config import CLEAN_DIR, DATA_DIR

RADIO_M = 250
CATEGORIAS = ["PEATON", "MOTOCICLISTA", "CICLISTA", "PASAJERO", "CONDUCTOR"]
VICTIMAS = {"HERIDO", "MUERTO"}
ANIO_INICIO = 2019
PERIODOS = {"1_ANTES": "antes", "4_DESPUES": "despues"}

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def cargar_grupos():
    """id_siniestro -> sitio (o 'CONTROL'), solo siniestros con distancia a cámara."""
    grupo = {}
    with open(CLEAN_DIR / "siniestros.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            d = r["dist_camara_m"]
            if d == "":
                continue
            if float(d) <= RADIO_M:
                if r["sitio_cercano"]:
                    grupo[r["id_siniestro"]] = r["sitio_cercano"]
                else:
                    grupo[r["id_siniestro"]] = "_CERCA_SIN_SITIO"
            else:
                grupo[r["id_siniestro"]] = "CONTROL"
    return grupo


def main():
    grupo = cargar_grupos()
    conteo = defaultdict(lambda: {p: {c: 0 for c in CATEGORIAS} for p in PERIODOS.values()})
    with open(CLEAN_DIR / "actores.csv", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            p = r["periodo"]
            if p not in PERIODOS:
                continue
            if p == "1_ANTES" and int(r["anio"]) < ANIO_INICIO:
                continue
            if r["gravedad"] not in VICTIMAS or r["condicion"] not in CATEGORIAS:
                continue
            g = grupo.get(r["id_siniestro"])
            if g is None:
                continue
            conteo[g][PERIODOS[p]][r["condicion"]] += 1

    sitios = {k: v for k, v in conteo.items() if k not in ("CONTROL", "_CERCA_SIN_SITIO")}

    # Validación contra actores_mecanismo.json (grupo CERCA)
    with open(DATA_DIR / "actores_mecanismo.json", encoding="utf-8") as f:
        ref = json.load(f)["grupos"]
    for per in ("antes", "despues"):
        suma = {c: sum(s[per][c] for s in sitios.values()) + conteo["_CERCA_SIN_SITIO"][per][c] for c in CATEGORIAS}
        assert suma == ref["CERCA"][per], f"CERCA {per}: {suma} != {ref['CERCA'][per]}"
        assert dict(conteo["CONTROL"][per]) == ref["CONTROL"][per], f"CONTROL {per} no coincide"

    salida = {
        "categorias": CATEGORIAS,
        "radio_m": RADIO_M,
        "antes": [f"{ANIO_INICIO}-01-01", "2019-10-31"],
        "despues": ["2021-01-01", "2022-12-31"],
        "control": conteo["CONTROL"],
        "sitios": dict(sorted(sitios.items())),
        "generado": date.today().isoformat(),
    }
    with open(DATA_DIR / "actores_por_sitio.json", "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    print(f"actores_por_sitio.json: {len(sitios)} sitios; suma = grupo CERCA de actores_mecanismo.json ✔")


if __name__ == "__main__":
    main()

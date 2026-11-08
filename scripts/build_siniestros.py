import csv
import math

import openpyxl

from config import ACCIDENTALIDAD_DIR, CLEAN_DIR, INICIO_INSTALACION, INICIO_COVID, INICIO_DESPUES
from geo_utils import to_xy
from text_utils import norm_text, norm_gravedad, norm_flag, norm_gravedad_persona, norm_condicion

DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]


def periodo_de(fecha_iso):
    if fecha_iso < "2019-11-01":
        return "1_ANTES"
    if fecha_iso < INICIO_COVID:
        return "2_INSTALACION"
    if fecha_iso < INICIO_DESPUES:
        return "3_COVID_2020"
    return "4_DESPUES"


def leer_hoja(path, sheet):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    for r in rows:
        yield dict(zip(header, r))
    wb.close()


def g(row, *candidatos, default=None):
    for c in candidatos:
        if c in row and row[c] is not None:
            return row[c]
    return default


def cargar_camaras():
    camaras = []
    with open(CLEAN_DIR / "camaras.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["lat"] and row["lon"]:
                camaras.append({
                    "corredor": row["corredor"] or "",
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                })
    return camaras


def corredores_unicos(camaras):
    vistos, out = set(), []
    for c in camaras:
        key = norm_text(c["corredor"])
        if key and key not in vistos:
            vistos.add(key)
            out.append((key, c["corredor"]))
    return out


def coincide_corredor(direccion, corredores):
    txt = norm_text(direccion)
    if not txt:
        return None
    for key, nombre in corredores:
        palabras = [p for p in key.replace(".", "").split() if len(p) > 3 and p not in ("AVENIDA", "CARRERA", "CALLE")]
        if palabras and all(p in txt for p in palabras):
            return nombre
    return None


def distancia_camara_m(lat, lon, camaras):
    if lat is None or lon is None:
        return None
    px, py = to_xy(lon, lat)
    best = math.inf
    for c in camaras:
        cx, cy = to_xy(c["lon"], c["lat"])
        d = math.hypot(px - cx, py - cy)
        if d < best:
            best = d
    return round(best, 1) if best != math.inf else None


def siniestros_2018(path, camaras, corredores):
    out = []
    for row in leer_hoja(path, "ACCIDENTES"):
        fecha = g(row, "Fecha")
        if fecha is None:
            continue
        fecha_iso = fecha.date().isoformat()
        direccion = g(row, "Direccion", default="")
        corredor_match = coincide_corredor(direccion, corredores)
        out.append({
            "id_siniestro": f"2018-{g(row, 'idFormulario')}",
            "fecha": fecha_iso,
            "anio": fecha.year,
            "mes": fecha.month,
            "dia_semana": DIAS[fecha.weekday()],
            "hora": g(row, "HORA_PROCESADA"),
            "periodo": periodo_de(fecha_iso),
            "gravedad": norm_gravedad(g(row, "GravedadNombre")),
            "clase": g(row, "ClaseNombre"),
            "localidad": g(row, "Localidad"),
            "direccion": direccion,
            "lat": None,
            "lon": None,
            "dist_camara_m": None,
            "corredor_camara_texto": "SI" if corredor_match else "NO",
            "corredor_nombre": corredor_match,
            "con_moto": norm_flag(g(row, "CON_MOTO")),
            "con_peaton": norm_flag(g(row, "CON_PEATON")),
            "con_bicicleta": norm_flag(g(row, "CON_BICICLETA")),
            "con_velocidad": norm_flag(g(row, "CON_VELOCIDAD")),
            "con_embriaguez": norm_flag(g(row, "CON_EMBRIAGUEZ")),
            "con_persona_mayor": norm_flag(g(row, "CON_PERSONA_MAYOR")),
        })
    return out


def actores_2018(path):
    out = []
    for row in leer_hoja(path, "CONDUCTORES"):
        fecha = g(row, "Fecha")
        if fecha is None:
            continue
        fecha_iso = fecha.date().isoformat()
        out.append({
            "id_siniestro": f"2018-{g(row, 'idFormulario')}",
            "anio": fecha.year,
            "periodo": periodo_de(fecha_iso),
            "condicion": "CONDUCTOR",
            "gravedad": norm_gravedad_persona(g(row, "GRAVEDAD_PROCESADA")),
            "gravedad_30d": None,
            "edad": g(row, "EDAD_PROCESADA"),
            "sexo": norm_text(g(row, "Sexo")),
        })
    for row in leer_hoja(path, "VICTIMAS"):
        fecha = g(row, "Fecha")
        if fecha is None:
            continue
        fecha_iso = fecha.date().isoformat()
        out.append({
            "id_siniestro": f"2018-{g(row, 'idFormulario')}",
            "anio": fecha.year,
            "periodo": periodo_de(fecha_iso),
            "condicion": norm_condicion(g(row, "Peaton_Pasajero")),
            "gravedad": norm_gravedad_persona(g(row, "GRAVEDAD_PROCESADA")),
            "gravedad_30d": None,
            "edad": g(row, "EDAD_PROCESADA"),
            "sexo": norm_text(g(row, "Sexo")),
        })
    return out


def siniestros_sigat(path, anio, camaras, corredores):
    es_codigo = anio in (2020, 2021)
    out = []
    for row in leer_hoja(path, "SINIESTROS"):
        fecha = g(row, "FECHA")
        if fecha is None:
            continue
        fecha_iso = fecha.date().isoformat()
        direccion = g(row, "Direccion", "DIRECCION", default="")
        lat = g(row, "LATITUD")
        lon = g(row, "LONGITUD")
        corredor_match = coincide_corredor(direccion, corredores)
        out.append({
            "id_siniestro": f"{anio}-{g(row, 'Accidente', 'CODIGO_ACCIDENTE')}",
            "fecha": fecha_iso,
            "anio": fecha.year,
            "mes": fecha.month,
            "dia_semana": DIAS[fecha.weekday()],
            "hora": g(row, "HORA", "hourAcc"),
            "periodo": periodo_de(fecha_iso),
            "gravedad": norm_gravedad(g(row, "GravedadNombre"), es_codigo=es_codigo),
            "clase": g(row, "ChoqueNombre", "CHOQUE"),
            "localidad": g(row, "Localidad", "LOCALIDAD"),
            "direccion": direccion,
            "lat": lat,
            "lon": lon,
            "dist_camara_m": distancia_camara_m(lat, lon, camaras),
            "corredor_camara_texto": "SI" if corredor_match else "NO",
            "corredor_nombre": corredor_match,
            "con_moto": norm_flag(g(row, "CON_MOTO")),
            "con_peaton": norm_flag(g(row, "CON_PEATON")),
            "con_bicicleta": norm_flag(g(row, "CON_BICICLETA")),
            "con_velocidad": norm_flag(g(row, "CON_VELOCIDAD")),
            "con_embriaguez": norm_flag(g(row, "CON_EMBRIAGUEZ")),
            "con_persona_mayor": norm_flag(g(row, "CON_PERSONA_MAYOR")),
        })
    return out


def actores_sigat(path, anio):
    out = []
    for row in leer_hoja(path, "ACTOR_VIAL"):
        fecha = g(row, "FECHA", "FechaAcc")
        if fecha is None:
            continue
        fecha_iso = fecha.date().isoformat()
        condicion = g(row, "CONDICION", "CONDICION_ACTV")
        gravedad30 = g(row, "GRAVEDAD_PROCESADA30")
        out.append({
            "id_siniestro": f"{anio}-{g(row, 'Accidente', 'CODIGO_ACCIDENTE')}",
            "anio": fecha.year,
            "periodo": periodo_de(fecha_iso),
            "condicion": norm_condicion(condicion),
            "gravedad": norm_gravedad_persona(g(row, "GRAVEDAD_PROCESADA", "GRAVEDAD_PROCESADA_ACTV")),
            "gravedad_30d": norm_gravedad_persona(gravedad30) if gravedad30 else None,
            "edad": g(row, "EDAD"),
            "sexo": norm_text(g(row, "SEXO", "GENERO_ACTv")),
        })
    return out


def main():
    camaras = cargar_camaras()
    corredores = corredores_unicos(camaras)

    siniestros = []
    actores = []

    siniestros += siniestros_2018(ACCIDENTALIDAD_DIR / "Base_2018.xlsx", camaras, corredores)
    actores += actores_2018(ACCIDENTALIDAD_DIR / "Base_2018.xlsx")

    for anio in (2019, 2020, 2021, 2022):
        path = ACCIDENTALIDAD_DIR / f"SIGAT_ANUARIO_{anio}.xlsx"
        siniestros += siniestros_sigat(path, anio, camaras, corredores)
        actores += actores_sigat(path, anio)

    sin_fields = ["id_siniestro", "fecha", "anio", "mes", "dia_semana", "hora", "periodo", "gravedad",
                  "clase", "localidad", "direccion", "lat", "lon", "dist_camara_m",
                  "corredor_camara_texto", "corredor_nombre", "con_moto", "con_peaton", "con_bicicleta",
                  "con_velocidad", "con_embriaguez", "con_persona_mayor"]
    with open(CLEAN_DIR / "siniestros.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=sin_fields)
        w.writeheader()
        for row in siniestros:
            w.writerow({k: row.get(k) for k in sin_fields})

    act_fields = ["id_siniestro", "anio", "periodo", "condicion", "gravedad", "gravedad_30d", "edad", "sexo"]
    with open(CLEAN_DIR / "actores.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=act_fields)
        w.writeheader()
        for row in actores:
            w.writerow({k: row.get(k) for k in act_fields})

    print(f"siniestros={len(siniestros)} actores={len(actores)}")
    print("por_anio:", {a: sum(1 for s in siniestros if s["anio"] == a) for a in range(2018, 2023)})
    print("con_corredor_camara:", sum(1 for s in siniestros if s["corredor_camara_texto"] == "SI"))


if __name__ == "__main__":
    main()

import csv
import json
import re

from config import CAMARAS_GEOJSON, TRAMOS_GEOJSON, CLEAN_DIR, DATA_DIR, RADIO_CAMARA_M
from geo_utils import point_to_multilinestring_distance

MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}

FECHA_RE = re.compile(r"([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+(\d{1,2})\s+de\s+(\d{4})")


def parse_fecha_activacion(texto):
    if not texto:
        return None
    m = FECHA_RE.search(texto)
    if not m:
        return None
    mes_txt, dia, anio = m.group(1).lower(), int(m.group(2)), int(m.group(3))
    mes = MESES.get(mes_txt)
    if mes is None:
        return None
    return f"{anio:04d}-{mes:02d}-{dia:02d}"


def load_camaras():
    with open(CAMARAS_GEOJSON, encoding="utf-8") as f:
        geo = json.load(f)
    camaras = []
    for feat in geo["features"]:
        p = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"]
        id_camara = p.get("ID_CÁMARA") or ""
        sitio = id_camara.split("/")[0] if "/" in id_camara else id_camara
        camaras.append({
            "id_camara": id_camara,
            "sitio": sitio,
            "nombre": p.get("NOMBRE_DEL"),
            "direccion": p.get("DIRECCIÓN"),
            "corredor": p.get("CORREDOR_P"),
            "via_secundaria": p.get("VIA_SECUND"),
            "sentido": p.get("SENTIDO"),
            "calzada": p.get("CALZADA"),
            "carriles": p.get("CARRILES"),
            "localidad": p.get("LOCALIDAD"),
            "limite_kmh": p.get("VELOCIDADM"),
            "infraccion": p.get("INFRACCION"),
            "resolucion": p.get("NÚMERO_DE"),
            "fecha_activacion": parse_fecha_activacion(p.get("NÚMERO_DE")),
            "lat": lat,
            "lon": lon,
        })
    return camaras


BOGOTA_LON_RANGO = (-74.5, -73.5)
BOGOTA_LAT_RANGO = (4.0, 5.0)


def coordenadas_validas(coords):
    puntos = []

    def recorrer(c):
        if isinstance(c[0], (int, float)):
            puntos.append(c)
        else:
            for x in c:
                recorrer(x)

    recorrer(coords)
    if not puntos:
        return False
    return all(
        BOGOTA_LON_RANGO[0] < lon < BOGOTA_LON_RANGO[1] and BOGOTA_LAT_RANGO[0] < lat < BOGOTA_LAT_RANGO[1]
        for lon, lat in puntos
    )


def load_tramos():
    with open(TRAMOS_GEOJSON, encoding="utf-8") as f:
        geo = json.load(f)
    tramos = []
    descartados = []
    for feat in geo["features"]:
        p = feat["properties"]
        coords = feat["geometry"]["coordinates"]
        if not coordenadas_validas(coords):
            descartados.append(p.get("TID"))
            continue
        tramos.append({
            "tid": p.get("TID"),
            "tipo": p.get("TYPE"),
            "via": p.get("NAME_FROM"),
            "entre": p.get("NAME_TO"),
            "codigo": p.get("CODIGO"),
            "distancia_m": p.get("DISTANCE"),
            "coordinates": coords,
        })
    if descartados:
        print(f"tramos con geometria invalida descartados: {descartados}")
    return tramos


def main():
    camaras = load_camaras()
    tramos = load_tramos()

    for cam in camaras:
        best_tid, best_dist = None, None
        for tramo in tramos:
            d = point_to_multilinestring_distance(cam["lon"], cam["lat"], tramo["coordinates"])
            if best_dist is None or d < best_dist:
                best_dist, best_tid = d, tramo["tid"]
        cam["tid_cercano"] = best_tid
        cam["dist_tid_m"] = round(best_dist, 1) if best_dist is not None else None

    con_camara_por_tid = {}
    for cam in camaras:
        if cam["dist_tid_m"] is not None and cam["dist_tid_m"] <= RADIO_CAMARA_M:
            con_camara_por_tid.setdefault(cam["tid_cercano"], []).append(cam)

    for tramo in tramos:
        cams_aqui = con_camara_por_tid.get(tramo["tid"], [])
        tramo["con_camara"] = len(cams_aqui) > 0
        tramo["n_camaras"] = len(cams_aqui)
        fechas = [c["fecha_activacion"] for c in cams_aqui if c["fecha_activacion"]]
        tramo["fecha_activacion"] = min(fechas) if fechas else None
        tramo["sitios"] = ";".join(sorted({c["sitio"] for c in cams_aqui}))

    sitios = {}
    for cam in camaras:
        s = sitios.setdefault(cam["sitio"], {
            "sitio": cam["sitio"],
            "corredor": cam["corredor"],
            "localidad": cam["localidad"],
            "n_camaras": 0,
            "lat_sum": 0.0,
            "lon_sum": 0.0,
            "fechas": [],
            "tids": set(),
        })
        s["n_camaras"] += 1
        s["lat_sum"] += cam["lat"]
        s["lon_sum"] += cam["lon"]
        if cam["fecha_activacion"]:
            s["fechas"].append(cam["fecha_activacion"])
        if cam["tid_cercano"] is not None:
            s["tids"].add(cam["tid_cercano"])

    sitios_rows = []
    for s in sitios.values():
        sitios_rows.append({
            "sitio": s["sitio"],
            "corredor": s["corredor"],
            "localidad": s["localidad"],
            "n_camaras": s["n_camaras"],
            "lat": round(s["lat_sum"] / s["n_camaras"], 6),
            "lon": round(s["lon_sum"] / s["n_camaras"], 6),
            "fecha_activacion": min(s["fechas"]) if s["fechas"] else None,
            "tids": ";".join(str(t) for t in sorted(s["tids"])),
        })

    camaras_fields = ["id_camara", "sitio", "nombre", "direccion", "corredor", "via_secundaria",
                       "sentido", "calzada", "carriles", "localidad", "limite_kmh", "infraccion",
                       "resolucion", "fecha_activacion", "lat", "lon", "tid_cercano", "dist_tid_m"]
    with open(CLEAN_DIR / "camaras.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=camaras_fields)
        w.writeheader()
        for cam in camaras:
            w.writerow({k: cam.get(k) for k in camaras_fields})

    tramos_fields = ["tid", "tipo", "via", "entre", "codigo", "distancia_m", "con_camara",
                      "n_camaras", "fecha_activacion", "sitios"]
    with open(CLEAN_DIR / "tramos.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=tramos_fields)
        w.writeheader()
        for tramo in tramos:
            w.writerow({k: tramo.get(k) for k in tramos_fields})

    sitios_fields = ["sitio", "corredor", "localidad", "n_camaras", "lat", "lon",
                      "fecha_activacion", "tids"]
    with open(CLEAN_DIR / "sitios.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=sitios_fields)
        w.writeheader()
        for row in sorted(sitios_rows, key=lambda r: r["sitio"]):
            w.writerow(row)

    with open(DATA_DIR / "camaras.json", "w", encoding="utf-8") as f:
        json.dump(camaras, f, ensure_ascii=False)

    tramos_out = [{k: v for k, v in t.items() if k != "coordinates"} for t in tramos]
    with open(DATA_DIR / "tramos.json", "w", encoding="utf-8") as f:
        json.dump(tramos_out, f, ensure_ascii=False)

    with open(DATA_DIR / "sitios.json", "w", encoding="utf-8") as f:
        json.dump(sorted(sitios_rows, key=lambda r: r["sitio"]), f, ensure_ascii=False)

    features = []
    for t in tramos:
        features.append({
            "type": "Feature",
            "properties": {k: v for k, v in t.items() if k != "coordinates"},
            "geometry": {"type": "MultiLineString", "coordinates": t["coordinates"]},
        })
    with open(DATA_DIR / "tramos.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)

    print(f"camaras={len(camaras)} tramos={len(tramos)} sitios={len(sitios_rows)}")
    print(f"tramos con_camara={sum(1 for t in tramos if t['con_camara'])}")


if __name__ == "__main__":
    main()

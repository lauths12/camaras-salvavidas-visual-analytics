import json
import math
import random

from direcciones import clave_cruce, parsear_direccion, clave_via


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class Geocodificador:
    def __init__(self, referencias):
        self.por_cruce = {}
        self.por_via = {}
        for direccion, lat, lon in referencias:
            p = parsear_direccion(direccion)
            if p is None:
                continue
            ck = clave_cruce(direccion)
            if ck is not None:
                self.por_cruce.setdefault(ck, []).append((lat, lon))
            for via_key_name, via, otra in (("via1", p["via1"], p["via2"]), ("via2", p["via2"], p["via1"])):
                vk = clave_via(via)
                ok = clave_via(otra)
                if vk is None:
                    continue
                num_otra = ok[1] if ok and isinstance(ok[1], int) else None
                self.por_via.setdefault(vk, []).append((num_otra, lat, lon))

    def geocodificar(self, direccion):
        p = parsear_direccion(direccion)
        if p is None:
            return None, None, "sin_parseo"
        ck = clave_cruce(direccion)
        if ck is not None and ck in self.por_cruce:
            pts = self.por_cruce[ck]
            lat = sum(x[0] for x in pts) / len(pts)
            lon = sum(x[1] for x in pts) / len(pts)
            return lat, lon, "cruce_exacto"

        k1, k2 = clave_via(p["via1"]), clave_via(p["via2"])
        target_num1 = k2[1] if k2 and isinstance(k2[1], int) else None
        target_num2 = k1[1] if k1 and isinstance(k1[1], int) else None

        for vk, target_num in ((k1, target_num1), (k2, target_num2)):
            if vk is None or vk not in self.por_via:
                continue
            candidatos = self.por_via[vk]
            if target_num is not None:
                con_num = [c for c in candidatos if c[0] is not None]
                if con_num:
                    con_num.sort(key=lambda c: abs(c[0] - target_num))
                    vecinos = con_num[:3]
                    lat = sum(v[1] for v in vecinos) / len(vecinos)
                    lon = sum(v[2] for v in vecinos) / len(vecinos)
                    return lat, lon, "interpolado_via"
            lat = sum(c[1] for c in candidatos) / len(candidatos)
            lon = sum(c[2] for c in candidatos) / len(candidatos)
            return lat, lon, "centroide_via"

        return None, None, "sin_referencia"


def validar_split_half(registros_2022, semilla=42):
    random.seed(semilla)
    datos = list(registros_2022)
    random.shuffle(datos)
    mitad = len(datos) // 2
    referencia, prueba = datos[:mitad], datos[mitad:]

    geo = Geocodificador(referencia)
    errores = []
    sin_match = 0
    for direccion, lat_real, lon_real in prueba:
        lat_est, lon_est, _ = geo.geocodificar(direccion)
        if lat_est is None:
            sin_match += 1
            continue
        errores.append(haversine_m(lat_real, lon_real, lat_est, lon_est))

    errores.sort()
    n = len(errores)

    def pct(umbral):
        return round(100 * sum(1 for e in errores if e <= umbral) / n, 1) if n else None

    def mediana(xs):
        if not xs:
            return None
        m = len(xs) // 2
        return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2

    return {
        "n_prueba": len(prueba),
        "n_con_estimacion": n,
        "n_sin_match": sin_match,
        "pct_sin_match": round(100 * sin_match / len(prueba), 1) if prueba else None,
        "error_mediano_m": round(mediana(errores), 1) if errores else None,
        "pct_menor_100m": pct(100),
        "pct_menor_250m": pct(250),
        "pct_menor_500m": pct(500),
    }

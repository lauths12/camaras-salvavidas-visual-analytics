import json

import pandas as pd

from config import CLEAN_DIR, DATA_DIR
from geocodificar import Geocodificador, haversine_m, validar_split_half


def cargar_camaras():
    with open(DATA_DIR / "camaras.json", encoding="utf-8") as f:
        return json.load(f)


def distancia_camara_mas_cercana(lat, lon, camaras):
    mejor_sitio, mejor_dist = None, None
    for cam in camaras:
        d = haversine_m(lat, lon, cam["lat"], cam["lon"])
        if mejor_dist is None or d < mejor_dist:
            mejor_dist, mejor_sitio = d, cam["sitio"]
    return mejor_sitio, mejor_dist


def main():
    df = pd.read_csv(CLEAN_DIR / "siniestros.csv")
    camaras = cargar_camaras()

    d22 = df[(df["anio"] == 2022) & df["lat"].notna() & df["lon"].notna()]
    referencias_2022 = list(zip(d22["direccion"], d22["lat"], d22["lon"]))
    validacion = validar_split_half(referencias_2022)
    with open(DATA_DIR / "calidad_geocod.json", "w", encoding="utf-8") as f:
        json.dump(validacion, f, ensure_ascii=False, indent=0)
    print("calidad_geocod:", validacion)

    geo = Geocodificador(referencias_2022)

    lat_final, lon_final, fuente, sitio_cercano, dist_m = [], [], [], [], []
    for _, row in df.iterrows():
        if pd.notna(row["lat"]) and pd.notna(row["lon"]):
            lat, lon, fte = row["lat"], row["lon"], "real"
        else:
            lat, lon, metodo = geo.geocodificar(row["direccion"])
            fte = metodo if lat is not None else "sin_match"
        lat_final.append(lat)
        lon_final.append(lon)
        fuente.append(fte)
        if lat is not None and lon is not None:
            s, d = distancia_camara_mas_cercana(lat, lon, camaras)
            sitio_cercano.append(s)
            dist_m.append(round(d, 1))
        else:
            sitio_cercano.append(None)
            dist_m.append(None)

    df["lat"] = lat_final
    df["lon"] = lon_final
    df["geo_fuente"] = fuente
    df["sitio_cercano"] = sitio_cercano
    df["dist_camara_m"] = dist_m

    df.to_csv(CLEAN_DIR / "siniestros.csv", index=False)
    print("geo_fuente:", df["geo_fuente"].value_counts().to_dict())
    print("con distancia a camara:", df["dist_camara_m"].notna().sum(), "/", len(df))


if __name__ == "__main__":
    main()

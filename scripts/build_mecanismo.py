"""Datos de la página «Del resultado al mecanismo» (mecanismo.html).

Solo escribe archivos nuevos:
  - data/sitios_mecanismo.json   (escenas 1-4: siniestros graves y velocidad por sitio)
  - data/actores_mecanismo.json  (escena 6: víctimas por condición, cerca vs. control)

No toca ningún JSON que ya consuma index.html. Lee data/clean/*.csv, data/sitios.json
y data/exposicion_camaras.json, que ya existen.

La asignación siniestro -> sitio y el grupo de control son los mismos de build_efecto.py:
un siniestro es de TRATAMIENTO si dist_camara_m <= 250 (coordenada real en 2022,
geocodificada en 2018-2021) y se asigna a su sitio_cercano; el resto es CONTROL.
"""
import json
from datetime import date

import numpy as np
import pandas as pd

from build_efecto import RADIO_TRATAMIENTO_M, cargar_siniestros
from config import CLEAN_DIR, DATA_DIR, INICIO_DESPUES, INICIO_INSTALACION

GRAVEDADES_GRAVES = ["CON HERIDOS", "CON MUERTOS"]
FRANJA_VELOCIDAD = "NOCHE"
UMBRALES_SINIESTROS_PCT = [-40, -15, 15, 40]
UMBRALES_VELOCIDAD_KMH = [-5, -2, 2]
MIN_SINIESTROS = 5

# Periodos de la comparación (los mismos 1_ANTES / 4_DESPUES del modelo de efecto; 2020 queda fuera).
ANTES = ("2018-01-01", "2019-10-31")
DESPUES = (INICIO_DESPUES, "2022-12-31")
assert INICIO_INSTALACION == "2019-11-01"

CATEGORIAS_ACTORES = ["PEATON", "MOTOCICLISTA", "CICLISTA", "PASAJERO", "CONDUCTOR"]
ANIO_INICIO_ACTORES = 2019
GRAVEDADES_VICTIMA = ["HERIDO", "MUERTO"]


def meses_entre(inicio, fin):
    a, b = pd.Timestamp(inicio), pd.Timestamp(fin)
    return (b.year - a.year) * 12 + (b.month - a.month) + 1


def r2(v):
    if v is None:
        return None
    v = float(v)
    return None if not np.isfinite(v) else round(v, 2)


def clase_siniestros(pct):
    if pct is None:
        return "sin_datos"
    u = UMBRALES_SINIESTROS_PCT
    if pct <= u[0]:
        return "baja_fuerte"
    if pct <= u[1]:
        return "baja"
    if pct < u[2]:
        return "igual"
    if pct < u[3]:
        return "sube"
    return "sube_fuerte"


def clase_velocidad(delta):
    if delta is None:
        return "sin_datos"
    u = UMBRALES_VELOCIDAD_KMH
    if delta <= u[0]:
        return "baja_fuerte"
    if delta <= u[1]:
        return "baja"
    if delta < u[2]:
        return "igual"
    return "sube"


def coincidencia(cs, cv):
    if cs == "sin_datos" or cv == "sin_datos":
        return "sin_datos"
    if cs.startswith("baja") and cv.startswith("baja"):
        return "bajan_ambos"
    if cs.startswith("sube") and cv.startswith("sube"):
        return "suben_ambos"
    return "otro"


def direccion(clase):
    if clase.startswith("baja"):
        return "baja"
    if clase.startswith("sube"):
        return "sube"
    return clase  # "igual" o "sin_datos"


def construir_sitios(df, sitios, expo):
    meses_antes = meses_entre(*ANTES)
    meses_despues = meses_entre(*DESPUES)

    base = df[df["periodo"].isin(["1_ANTES", "4_DESPUES"]) & df["gravedad"].isin(GRAVEDADES_GRAVES)]
    trat = base[(base["grupo"] == "TRATAMIENTO") & base["sitio_cercano"].notna()]
    ctrl = base[base["grupo"] == "CONTROL"]

    ctrl_antes = int((ctrl["periodo"] == "1_ANTES").sum())
    ctrl_despues = int((ctrl["periodo"] == "4_DESPUES").sum())
    tasa_ctrl_antes = ctrl_antes / meses_antes
    tasa_ctrl_despues = ctrl_despues / meses_despues
    razon_ctrl = tasa_ctrl_despues / tasa_ctrl_antes

    conteo = trat.groupby(["sitio_cercano", "periodo"]).size().unstack(fill_value=0)

    vel = {e["tid"]: e for e in expo[FRANJA_VELOCIDAD]}
    mediana_ctrl_vel = float(np.median([e["delta_p85"] for e in expo[FRANJA_VELOCIDAD] if not e["con_camara"]]))

    filas = []
    for s in sitios:
        sid = s["sitio"]
        a = int(conteo.loc[sid, "1_ANTES"]) if sid in conteo.index and "1_ANTES" in conteo.columns else 0
        d = int(conteo.loc[sid, "4_DESPUES"]) if sid in conteo.index and "4_DESPUES" in conteo.columns else 0
        tasa_a, tasa_d = a / meses_antes, d / meses_despues
        pocos = (a + d) < MIN_SINIESTROS or a == 0
        cambio = None if pocos else (tasa_d / tasa_a) / razon_ctrl * 100 - 100

        tids = [t for t in str(s.get("tids") or "").split(";") if t]
        con_dato = [vel[int(t)] for t in tids if int(t) in vel]
        tiene_vel = bool(con_dato)
        p85_a = float(np.mean([v["p85_antes"] for v in con_dato])) if tiene_vel else None
        p85_d = float(np.mean([v["p85_despues"] for v in con_dato])) if tiene_vel else None
        delta = float(np.mean([v["delta_p85"] for v in con_dato])) if tiene_vel else None
        delta_vs = delta - mediana_ctrl_vel if tiene_vel else None

        cs = clase_siniestros(None if cambio is None else round(cambio, 2))
        cv = clase_velocidad(None if delta_vs is None else round(delta_vs, 2))
        filas.append({
            "sitio": sid,
            "corredor": s["corredor"],
            "lat": s["lat"], "lon": s["lon"],
            "n_camaras": int(s["n_camaras"]),
            "fecha_activacion": s.get("fecha_activacion"),
            "graves_antes": a, "graves_despues": d,
            "tasa_antes": r2(tasa_a), "tasa_despues": r2(tasa_d),
            "cambio_vs_control_pct": r2(cambio),
            "pocos_datos": bool(pocos),
            "tids": tids,
            "tids_con_velocidad": [str(v["tid"]) for v in con_dato],
            "tiene_velocidad": tiene_vel,
            "p85_antes": r2(p85_a), "p85_despues": r2(p85_d),
            "delta_p85": r2(delta), "delta_p85_vs_control": r2(delta_vs),
            "clase_siniestros": cs,
            "clase_velocidad": cv,
            "coincide": coincidencia(cs, cv),
        })

    # Correlación sobre los sitios con velocidad y suficientes siniestros.
    corr = [f for f in filas if f["tiene_velocidad"] and not f["pocos_datos"]]
    x = np.array([f["delta_p85_vs_control"] for f in corr], dtype=float)
    y = np.array([f["cambio_vs_control_pct"] for f in corr], dtype=float)
    if len(corr) >= 3:
        r_p = float(np.corrcoef(x, y)[0, 1])
        r_s = float(pd.Series(x).rank().corr(pd.Series(y).rank()))
        pendiente, intercepto = np.polyfit(x, y, 1)
    else:
        r_p = r_s = pendiente = intercepto = None

    # Tabla 2x2 (dirección del cambio): filas = siniestros, columnas = velocidad.
    tabla = {"baja": {"baja": 0, "sube": 0}, "sube": {"baja": 0, "sube": 0}}
    n_igual = 0
    for f in corr:
        ds, dv = direccion(f["clase_siniestros"]), direccion(f["clase_velocidad"])
        if ds in tabla and dv in tabla[ds]:
            tabla[ds][dv] += 1
        else:
            n_igual += 1

    resumen = {
        "n_sitios": len(filas),
        "n_con_velocidad": sum(f["tiene_velocidad"] for f in filas),
        "n_pocos_datos": sum(f["pocos_datos"] for f in filas),
        "n_con_ambos": len(corr),
        "n_tramos_distintos": len({tuple(f["tids_con_velocidad"]) for f in corr}),
        "n_bajan_ambos": sum(f["coincide"] == "bajan_ambos" for f in filas),
        "n_suben_ambos": sum(f["coincide"] == "suben_ambos" for f in filas),
        "n_otro": sum(f["coincide"] == "otro" for f in filas),
        "clases_siniestros": pd.Series([f["clase_siniestros"] for f in filas]).value_counts().to_dict(),
        "clases_velocidad": pd.Series([f["clase_velocidad"] for f in filas]).value_counts().to_dict(),
        "tabla_2x2": tabla,
        "n_cambio_pequeno": n_igual,
        "graves_trat_antes": int(sum(f["graves_antes"] for f in filas)),
        "graves_trat_despues": int(sum(f["graves_despues"] for f in filas)),
        "graves_ctrl_antes": ctrl_antes,
        "graves_ctrl_despues": ctrl_despues,
    }

    salida = {
        "meta": {
            "radio_m": RADIO_TRATAMIENTO_M,
            "gravedades": GRAVEDADES_GRAVES,
            "antes": list(ANTES),
            "despues": list(DESPUES),
            "meses_antes": meses_antes,
            "meses_despues": meses_despues,
            "franja_velocidad": FRANJA_VELOCIDAD,
            "periodo_velocidad": (
                "Como en build_exposicion.py: p85 promedio ponderado por lecturas, periodo 1_ANTES "
                "(meses con día 15 antes del 2019-11-01; hay datos desde feb. 2019) contra 4_DESPUES "
                "(desde 2021; en los tramos con cámara casi solo hay datos hasta sep. 2021). "
                "Velocidad del sitio = media de los tramos a 50 m o menos (tids) con dato."
            ),
            "umbrales_siniestros_pct": UMBRALES_SINIESTROS_PCT,
            "umbrales_velocidad_kmh": UMBRALES_VELOCIDAD_KMH,
            "min_siniestros": MIN_SINIESTROS,
            "r_pearson": r2(r_p),
            "r_spearman": r2(r_s),
            "n_correlacion": len(corr),
            "recta": {"pendiente": r2(pendiente), "intercepto": r2(intercepto)},
            "resumen": resumen,
            "generado": date.today().isoformat(),
        },
        "control": {
            "graves_antes": ctrl_antes,
            "graves_despues": ctrl_despues,
            "tasa_antes": r2(tasa_ctrl_antes),
            "tasa_despues": r2(tasa_ctrl_despues),
            "razon": round(razon_ctrl, 4),
            "delta_p85_mediana": r2(mediana_ctrl_vel),
        },
        "sitios": filas,
    }
    with open(DATA_DIR / "sitios_mecanismo.json", "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    return salida


def construir_actores(df):
    actores = pd.read_csv(CLEAN_DIR / "actores.csv", usecols=["id_siniestro", "anio", "periodo", "condicion", "gravedad"])
    # 2018 no distingue MOTOCICLISTA ni CICLISTA (todo el que conduce es CONDUCTOR), así que
    # para esta escena el "antes" es solo ene-oct 2019, que usa la misma clasificación que 2021-2022.
    actores = actores[
        (((actores["periodo"] == "1_ANTES") & (actores["anio"] >= ANIO_INICIO_ACTORES))
         | (actores["periodo"] == "4_DESPUES"))
        & actores["gravedad"].isin(GRAVEDADES_VICTIMA)
        & actores["condicion"].isin(CATEGORIAS_ACTORES)
    ]
    grupo = df.set_index("id_siniestro")["grupo"]
    actores = actores.assign(grupo=actores["id_siniestro"].map(grupo))
    sin_grupo = int(actores["grupo"].isna().sum())
    actores = actores[actores["grupo"].notna()]

    nombres = {"TRATAMIENTO": "CERCA", "CONTROL": "CONTROL"}
    periodos = {"1_ANTES": "antes", "4_DESPUES": "despues"}
    grupos = {}
    for g_df, g_out in nombres.items():
        grupos[g_out] = {}
        for p_df, p_out in periodos.items():
            sub = actores[(actores["grupo"] == g_df) & (actores["periodo"] == p_df)]
            vc = sub["condicion"].value_counts()
            grupos[g_out][p_out] = {c: int(vc.get(c, 0)) for c in CATEGORIAS_ACTORES}

    salida = {
        "categorias": CATEGORIAS_ACTORES,
        "victimas": GRAVEDADES_VICTIMA,
        "radio_m": RADIO_TRATAMIENTO_M,
        "antes": [f"{ANIO_INICIO_ACTORES}-01-01", ANTES[1]],
        "despues": list(DESPUES),
        "nota_antes": (
            "El antes empieza en 2019 y no en 2018 porque el anuario 2018 no separa motociclistas "
            "ni ciclistas: todos aparecen como CONDUCTOR."
        ),
        "grupos": grupos,
        "n_sin_distancia": sin_grupo,
        "generado": date.today().isoformat(),
    }
    with open(DATA_DIR / "actores_mecanismo.json", "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=1)
    return salida


def validar(salida, df):
    meta, res = salida["meta"], salida["meta"]["resumen"]
    print(f"sitios: {res['n_sitios']} · con velocidad: {res['n_con_velocidad']} · pocos datos: {res['n_pocos_datos']}"
          f" · en la correlación: {res['n_con_ambos']} ({res['n_tramos_distintos']} combinaciones de tramo distintas)")
    print("clases siniestros:", res["clases_siniestros"])
    print("clases velocidad: ", res["clases_velocidad"])
    print(f"coinciden: bajan_ambos={res['n_bajan_ambos']} suben_ambos={res['n_suben_ambos']} otro={res['n_otro']}")
    t = res["tabla_2x2"]
    print("tabla 2x2 (filas siniestros, columnas velocidad):")
    print(f"              vel baja  vel sube")
    print(f"  sin baja    {t['baja']['baja']:8d}  {t['baja']['sube']:8d}")
    print(f"  sin sube    {t['sube']['baja']:8d}  {t['sube']['sube']:8d}")
    print(f"  (+{res['n_cambio_pequeno']} con cambio pequeño en alguna de las dos)")
    print(f"r Pearson={meta['r_pearson']} Spearman={meta['r_spearman']} n={meta['n_correlacion']} recta={meta['recta']}")
    print("control:", salida["control"])

    assert res["n_sitios"] == 40, "se esperaban 40 sitios"

    # Coherencia con build_efecto.py: graves a <=250 m (TRATAMIENTO) en 1_ANTES / 4_DESPUES.
    base = df[df["periodo"].isin(["1_ANTES", "4_DESPUES"]) & df["gravedad"].isin(GRAVEDADES_GRAVES)]
    tr = base[base["grupo"] == "TRATAMIENTO"]
    esperado_a = int((tr["periodo"] == "1_ANTES").sum())
    esperado_d = int((tr["periodo"] == "4_DESPUES").sum())
    print(f"graves cerca de los sitios: antes {res['graves_trat_antes']} (efecto: {esperado_a}) · "
          f"después {res['graves_trat_despues']} (efecto: {esperado_d})")
    assert (res["graves_trat_antes"], res["graves_trat_despues"]) == (esperado_a, esperado_d), \
        "la suma por sitio no coincide con el grupo de tratamiento de build_efecto.py"

    # Y con por_gravedad.json, que ya consume el tablero (mismo con_corredor()).
    with open(DATA_DIR / "por_gravedad.json", encoding="utf-8") as f:
        pg = json.load(f)
    pg_a = sum(r["antes"] for r in pg["corredores"] if not r["es_control"] and r["gravedad"] in GRAVEDADES_GRAVES)
    pg_d = sum(r["despues"] for r in pg["corredores"] if not r["es_control"] and r["gravedad"] in GRAVEDADES_GRAVES)
    print(f"por_gravedad.json (corredores, graves): antes {pg_a} · después {pg_d}")
    assert (pg_a, pg_d) == (esperado_a, esperado_d), "no coincide con por_gravedad.json"


def main():
    df = cargar_siniestros()
    with open(DATA_DIR / "sitios.json", encoding="utf-8") as f:
        sitios = json.load(f)
    with open(DATA_DIR / "exposicion_camaras.json", encoding="utf-8") as f:
        expo = json.load(f)

    salida = construir_sitios(df, sitios, expo)
    validar(salida, df)

    actores = construir_actores(df)
    print("actores_mecanismo:", json.dumps(actores["grupos"], ensure_ascii=False))
    print("víctimas sin distancia a cámara (descartadas):", actores["n_sin_distancia"])


if __name__ == "__main__":
    main()

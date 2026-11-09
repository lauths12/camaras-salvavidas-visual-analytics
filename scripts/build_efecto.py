import json

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from config import CLEAN_DIR, DATA_DIR, SEVERIDADES

RNG = np.random.default_rng(20240101)
N_BOOTSTRAP = 300
RADIO_TRATAMIENTO_M = 250
RADIOS_SENSIBILIDAD_M = [150, 250, 500]


def franja_de_hora(hora):
    if pd.isna(hora):
        return None
    hora = int(hora)
    if hora <= 4:
        return "MADRUGADA"
    if hora <= 8:
        return "PICO_MANANA"
    if hora <= 15:
        return "VALLE"
    if hora <= 19:
        return "PICO_TARDE"
    return "NOCHE"


def cargar_siniestros(radio_m=RADIO_TRATAMIENTO_M):
    df = pd.read_csv(CLEAN_DIR / "siniestros.csv")
    df = df[df["dist_camara_m"].notna()].copy()
    df["grupo"] = np.where(df["dist_camara_m"] <= radio_m, "TRATAMIENTO", "CONTROL")
    return df


def ajustar_poisson(panel):
    modelo = smf.glm(
        "n ~ C(mes) + tratamiento * despues",
        data=panel,
        family=sm_poisson_family(),
    ).fit()
    return modelo.params.get("tratamiento:despues", np.nan)


def sm_poisson_family():
    import statsmodels.api as sm
    return sm.families.Poisson()


def panel_mensual(df_subset):
    panel = (
        df_subset.groupby(["grupo", "anio", "mes"])
        .size()
        .reset_index(name="n")
    )
    panel["tratamiento"] = (panel["grupo"] == "TRATAMIENTO").astype(int)
    panel["despues"] = (panel["anio"] >= 2021).astype(int)
    return panel


def efecto_para_subset(df_subset):
    panel = panel_mensual(df_subset)
    coef_obs = ajustar_poisson(panel)

    n = len(df_subset)
    boot_coefs = []
    idx = df_subset.index.to_numpy()
    for _ in range(N_BOOTSTRAP):
        muestra_idx = RNG.choice(idx, size=n, replace=True)
        muestra = df_subset.loc[muestra_idx]
        panel_b = panel_mensual(muestra)
        try:
            coef = ajustar_poisson(panel_b)
            if np.isfinite(coef):
                boot_coefs.append(coef)
        except Exception:
            continue

    if boot_coefs:
        lo, hi = np.percentile(boot_coefs, [2.5, 97.5])
    else:
        lo, hi = np.nan, np.nan

    return {
        "efecto_log": None if pd.isna(coef_obs) else round(float(coef_obs), 4),
        "razon_tasa": None if pd.isna(coef_obs) else round(float(np.exp(coef_obs)), 4),
        "ci95_bajo": None if pd.isna(lo) else round(float(np.exp(lo)), 4),
        "ci95_alto": None if pd.isna(hi) else round(float(np.exp(hi)), 4),
        "n_bootstrap": len(boot_coefs),
    }


def construir_efecto_promedio(df):
    base = df[df["periodo"].isin(["1_ANTES", "4_DESPUES"])].copy()
    resultados = {"TODAS": efecto_para_subset(base)}
    for sev in SEVERIDADES:
        subset = base[base["gravedad"] == sev]
        if len(subset) > 20:
            resultados[sev] = efecto_para_subset(subset)
    with open(DATA_DIR / "efecto_promedio.json", "w", encoding="utf-8") as f:
        json.dump(resultados, f, ensure_ascii=False, indent=0)
    print("efecto_promedio:", resultados)


def construir_efecto_por_radio():
    resultados = []
    for radio in RADIOS_SENSIBILIDAD_M:
        df_r = cargar_siniestros(radio)
        base = df_r[df_r["periodo"].isin(["1_ANTES", "4_DESPUES"])]
        efecto = efecto_para_subset(base)
        efecto["radio_m"] = radio
        efecto["n_tratamiento"] = int((base["grupo"] == "TRATAMIENTO").sum())
        efecto["n_control"] = int((base["grupo"] == "CONTROL").sum())
        resultados.append(efecto)
    with open(DATA_DIR / "efecto_por_radio.json", "w", encoding="utf-8") as f:
        json.dump(resultados, f, ensure_ascii=False)
    print("efecto_por_radio:", resultados)


def construir_tendencia(df):
    conteos = df.groupby(["grupo", "anio"]).size().reset_index(name="n")
    series = {}
    for grupo, sub in conteos.groupby("grupo"):
        sub = sub.sort_values("anio")
        base_n = sub.iloc[0]["n"]
        serie = [
            {"anio": int(r["anio"]), "n": int(r["n"]), "indice": round(100 * r["n"] / base_n, 1)}
            for _, r in sub.iterrows()
        ]
        series[grupo] = serie
    with open(DATA_DIR / "tendencia.json", "w", encoding="utf-8") as f:
        json.dump(series, f, ensure_ascii=False)
    print("tendencia:", {k: len(v) for k, v in series.items()})


CORREDOR_CONTROL = "Resto de la ciudad (control)"


def cargar_sitio_a_corredor():
    sitios = pd.read_csv(CLEAN_DIR / "sitios.csv")
    return dict(zip(sitios["sitio"], sitios["corredor"]))


def con_corredor(df):
    sitio_a_corredor = cargar_sitio_a_corredor()
    cerca = df[(df["grupo"] == "TRATAMIENTO") & df["sitio_cercano"].notna()].copy()
    cerca["corredor"] = cerca["sitio_cercano"].map(sitio_a_corredor)
    cerca = cerca[cerca["corredor"].notna()]
    lejos = df[df["grupo"] == "CONTROL"].copy()
    lejos["corredor"] = CORREDOR_CONTROL
    return pd.concat([cerca, lejos], ignore_index=True)


def construir_corredores_ranking(df):
    antes = df[df["periodo"] == "1_ANTES"]
    despues = df[df["periodo"] == "4_DESPUES"]
    ciudad_cambio = 100 * (len(despues) - len(antes)) / max(len(antes), 1)

    con_corr = con_corredor(df)

    filas = []
    for corredor, grupo_df in con_corr.groupby("corredor"):
        a = (grupo_df["periodo"] == "1_ANTES").sum()
        d = (grupo_df["periodo"] == "4_DESPUES").sum()
        cambio = None if a == 0 else round(100 * (d - a) / a, 1)
        filas.append({
            "corredor": corredor,
            "antes": int(a),
            "despues": int(d),
            "cambio_pct": cambio,
            "cambio_pct_ciudad": round(ciudad_cambio, 1),
            "es_control": corredor == CORREDOR_CONTROL,
        })
    filas.sort(key=lambda r: (r["es_control"], r["cambio_pct"] is None, r["cambio_pct"]))
    with open(DATA_DIR / "corredores_ranking.json", "w", encoding="utf-8") as f:
        json.dump(filas, f, ensure_ascii=False)
    print("corredores_ranking filas:", len(filas))


def construir_heatmap(df):
    con_corr = con_corredor(df)
    tabla = con_corr.groupby(["corredor", "anio"]).size().reset_index(name="n")
    filas = [
        {"corredor": r["corredor"], "anio": int(r["anio"]), "n": int(r["n"]), "es_control": r["corredor"] == CORREDOR_CONTROL}
        for _, r in tabla.iterrows()
    ]
    with open(DATA_DIR / "heatmap.json", "w", encoding="utf-8") as f:
        json.dump(filas, f, ensure_ascii=False)
    print("heatmap filas:", len(filas))


def construir_por_gravedad(df):
    sub = df[df["gravedad"].isin(SEVERIDADES)].copy()
    con_corr = con_corredor(sub)

    corredores = []
    for (corredor, gravedad), grupo_df in con_corr.groupby(["corredor", "gravedad"]):
        a = (grupo_df["periodo"] == "1_ANTES").sum()
        d = (grupo_df["periodo"] == "4_DESPUES").sum()
        cambio = None if a == 0 else round(100 * (d - a) / a, 1)
        corredores.append({
            "corredor": corredor,
            "gravedad": gravedad,
            "antes": int(a),
            "despues": int(d),
            "cambio_pct": cambio,
            "es_control": corredor == CORREDOR_CONTROL,
        })

    tabla = con_corr.groupby(["corredor", "anio", "gravedad"]).size().reset_index(name="n")
    heatmap = [
        {
            "corredor": r["corredor"],
            "anio": int(r["anio"]),
            "gravedad": r["gravedad"],
            "n": int(r["n"]),
            "es_control": r["corredor"] == CORREDOR_CONTROL,
        }
        for _, r in tabla.iterrows()
    ]

    with open(DATA_DIR / "por_gravedad.json", "w", encoding="utf-8") as f:
        json.dump({"gravedades": SEVERIDADES, "corredores": corredores, "heatmap": heatmap}, f, ensure_ascii=False)
    print("por_gravedad filas corredores:", len(corredores), "filas heatmap:", len(heatmap))


def construir_gravedad_franja(df):
    sub = df.copy()
    sub["franja"] = sub["hora"].apply(franja_de_hora)
    sub = sub[sub["franja"].notna() & sub["gravedad"].notna()]
    tabla = sub.groupby(["franja", "gravedad"]).size().reset_index(name="n")
    totales = sub.groupby("franja").size().to_dict()
    filas = []
    for _, r in tabla.iterrows():
        total = totales[r["franja"]]
        filas.append({
            "franja": r["franja"],
            "gravedad": r["gravedad"],
            "n": int(r["n"]),
            "pct": round(100 * r["n"] / total, 2),
        })
    with open(DATA_DIR / "gravedad_franja.json", "w", encoding="utf-8") as f:
        json.dump(filas, f, ensure_ascii=False)
    print("gravedad_franja filas:", len(filas))


def construir_calidad():
    df_total = pd.read_csv(CLEAN_DIR / "siniestros.csv")
    por_anio = []
    for anio, sub in df_total.groupby("anio"):
        por_anio.append({
            "anio": int(anio),
            "total": int(len(sub)),
            "pct_coordenada_real": round(100 * (sub["geo_fuente"] == "real").mean(), 1),
            "pct_geocodificado": round(100 * sub["dist_camara_m"].notna().mean(), 1),
            "pct_en_250m": round(100 * (sub["dist_camara_m"] <= 250).mean(), 1),
        })
    with open(DATA_DIR / "calidad.json", "w", encoding="utf-8") as f:
        json.dump({"siniestros_por_anio": por_anio}, f, ensure_ascii=False)
    print("calidad:", por_anio)


def main():
    df = cargar_siniestros()
    construir_efecto_promedio(df)
    construir_efecto_por_radio()
    construir_tendencia(df)
    construir_corredores_ranking(df)
    construir_heatmap(df)
    construir_por_gravedad(df)
    construir_gravedad_franja(df)
    construir_calidad()


if __name__ == "__main__":
    main()

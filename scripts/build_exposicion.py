import csv
import json

from config import CLEAN_DIR, DATA_DIR

FRANJAS = ["MADRUGADA", "PICO_MANANA", "VALLE", "PICO_TARDE", "NOCHE"]


def periodo_de(anio, mes):
    fecha = f"{anio:04d}-{mes:02d}-15"
    if fecha < "2019-11-01":
        return "1_ANTES"
    if fecha < "2020-03-25":
        return "2_INSTALACION"
    if fecha < "2021-01-01":
        return "3_COVID_2020"
    return "4_DESPUES"


def cargar_tramos():
    tramos = {}
    with open(CLEAN_DIR / "tramos.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tramos[int(row["tid"])] = {
                "tid": int(row["tid"]),
                "n_camaras": int(row["n_camaras"]),
                "con_camara": row["con_camara"] == "True",
            }
    return tramos


def acumular(tramos):
    acc_todas = {}
    acc_franja = {franja: {} for franja in FRANJAS}
    with open(CLEAN_DIR / "velocidad_mensual.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tid = int(row["tid"])
            if tid not in tramos:
                continue
            periodo = periodo_de(int(row["anio"]), int(row["mes"]))
            peso = float(row["vel_p85"]) * int(row["lecturas"])
            lecturas = int(row["lecturas"])
            key = (tid, periodo)

            acc = acc_todas.setdefault(key, {"suma": 0.0, "n": 0})
            acc["suma"] += peso
            acc["n"] += lecturas

            franja = row["franja"]
            if franja in acc_franja:
                acc_f = acc_franja[franja].setdefault(key, {"suma": 0.0, "n": 0})
                acc_f["suma"] += peso
                acc_f["n"] += lecturas
    return acc_todas, acc_franja


def filas_desde(acumulado, tramos):
    filas = []
    for tid, tramo in tramos.items():
        antes = acumulado.get((tid, "1_ANTES"))
        despues = acumulado.get((tid, "4_DESPUES"))
        if not antes or not despues or antes["n"] == 0 or despues["n"] == 0:
            continue
        p85_antes = antes["suma"] / antes["n"]
        p85_despues = despues["suma"] / despues["n"]
        filas.append({
            "tid": tid,
            "n_camaras": tramo["n_camaras"],
            "con_camara": tramo["con_camara"],
            "p85_antes": round(p85_antes, 2),
            "p85_despues": round(p85_despues, 2),
            "delta_p85": round(p85_despues - p85_antes, 2),
        })
    return filas


def main():
    tramos = cargar_tramos()
    acc_todas, acc_franja = acumular(tramos)

    resultado = {"TODAS": filas_desde(acc_todas, tramos)}
    for franja in FRANJAS:
        resultado[franja] = filas_desde(acc_franja[franja], tramos)

    with open(DATA_DIR / "exposicion_camaras.json", "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False)

    print("exposicion_camaras TODAS:", len(resultado["TODAS"]), {f: len(resultado[f]) for f in FRANJAS})


if __name__ == "__main__":
    main()

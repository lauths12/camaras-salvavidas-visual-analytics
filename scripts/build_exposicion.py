import csv
import json

from config import CLEAN_DIR, DATA_DIR


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


def main():
    tramos = cargar_tramos()
    p85_por_tid_periodo = {}
    with open(CLEAN_DIR / "velocidad_mensual.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tid = int(row["tid"])
            if tid not in tramos:
                continue
            periodo = periodo_de(int(row["anio"]), int(row["mes"]))
            key = (tid, periodo)
            acc = p85_por_tid_periodo.setdefault(key, {"suma": 0.0, "n": 0})
            acc["suma"] += float(row["vel_p85"]) * int(row["lecturas"])
            acc["n"] += int(row["lecturas"])

    filas = []
    for tid, tramo in tramos.items():
        antes = p85_por_tid_periodo.get((tid, "1_ANTES"))
        despues = p85_por_tid_periodo.get((tid, "4_DESPUES"))
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

    with open(DATA_DIR / "exposicion_camaras.json", "w", encoding="utf-8") as f:
        json.dump(filas, f, ensure_ascii=False)

    print("exposicion_camaras filas:", len(filas))


if __name__ == "__main__":
    main()

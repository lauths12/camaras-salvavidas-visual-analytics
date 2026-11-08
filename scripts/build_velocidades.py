import glob

import duckdb

from config import VELOCIDADES_2019_2020_DIR, VELOCIDADES_2021_2022_DIR, CLEAN_DIR

MESES_EN = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def listar_csvs():
    patrones = [
        str(VELOCIDADES_2019_2020_DIR / "*" / "*.csv"),
        str(VELOCIDADES_2021_2022_DIR / "*" / "*.csv"),
    ]
    archivos = []
    for p in patrones:
        archivos += glob.glob(p)
    return archivos


def main():
    archivos = listar_csvs()
    print(f"archivos de velocidad encontrados: {len(archivos)}")

    con = duckdb.connect()
    con.execute(
        "CREATE OR REPLACE TABLE raw_vel AS "
        "SELECT * FROM read_csv(?, ignore_errors=true, union_by_name=true, all_varchar=true)",
        [archivos],
    )

    con.execute(
        """
        CREATE OR REPLACE TABLE vel_clean AS
        SELECT
            TRY_CAST(TID AS INTEGER) AS tid,
            TRY_CAST("AÑO" AS INTEGER) AS anio,
            LOWER(TRIM(MES)) AS mes_nombre,
            TRY_CAST(HORA AS INTEGER) AS hora,
            TRIM(DIA_SEMANA) AS dia_semana,
            TRY_CAST(REPLACE(VEL_PROMEDIO, ',', '.') AS DOUBLE) AS vel,
            INICIO
        FROM raw_vel
        """
    )

    con.execute(
        """
        CREATE OR REPLACE TABLE vel_dedup AS
        SELECT DISTINCT tid, anio, mes_nombre, hora, dia_semana, vel
        FROM vel_clean
        WHERE tid IS NOT NULL
          AND anio IS NOT NULL
          AND mes_nombre IS NOT NULL
          AND vel IS NOT NULL
          AND vel > 0
          AND vel <= 120
        """
    )

    meses_case = " ".join(f"WHEN '{k}' THEN {v}" for k, v in MESES_EN.items())
    con.execute(
        f"""
        CREATE OR REPLACE TABLE vel_mes AS
        SELECT
            tid, anio,
            CASE mes_nombre {meses_case} END AS mes,
            CASE
                WHEN hora <= 4 THEN 'MADRUGADA'
                WHEN hora <= 8 THEN 'PICO_MANANA'
                WHEN hora <= 15 THEN 'VALLE'
                WHEN hora <= 19 THEN 'PICO_TARDE'
                ELSE 'NOCHE'
            END AS franja,
            CASE WHEN dia_semana IN ('Sabado', 'Domingo') THEN 'FINDE' ELSE 'SEMANA' END AS tipo_dia,
            vel
        FROM vel_dedup
        """
    )

    con.execute(
        """
        CREATE OR REPLACE TABLE vel_agg AS
        SELECT
            tid, anio, mes, franja, tipo_dia,
            COUNT(*) AS lecturas,
            ROUND(AVG(vel), 2) AS vel_media,
            ROUND(MEDIAN(vel), 2) AS vel_mediana,
            ROUND(QUANTILE_CONT(vel, 0.85), 2) AS vel_p85
        FROM vel_mes
        WHERE mes IS NOT NULL
        GROUP BY tid, anio, mes, franja, tipo_dia
        ORDER BY tid, anio, mes, franja, tipo_dia
        """
    )

    con.execute(
        f"COPY vel_agg TO '{CLEAN_DIR / 'velocidad_mensual.csv'}' (HEADER, DELIMITER ',')"
    )

    total_grupos = con.execute("SELECT COUNT(*) FROM vel_agg").fetchone()[0]
    print(f"grupos tid x anio x mes x franja x tipo_dia: {total_grupos}")


if __name__ == "__main__":
    main()

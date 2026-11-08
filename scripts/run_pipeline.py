import subprocess
import sys
from pathlib import Path

PASOS = [
    "build_sitios_tramos.py",
    "build_siniestros.py",
    "build_velocidades.py",
    "build_geocodificacion.py",
    "build_efecto.py",
    "build_exposicion.py",
]


def main():
    aqui = Path(__file__).resolve().parent
    for paso in PASOS:
        print(f"=== {paso} ===")
        resultado = subprocess.run([sys.executable, str(aqui / paso)], cwd=aqui)
        if resultado.returncode != 0:
            sys.exit(resultado.returncode)


if __name__ == "__main__":
    main()

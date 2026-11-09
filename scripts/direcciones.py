import re

TIPOS = {
    "AK": "AK", "AC": "AC", "AV": "AV", "AVENIDA": "AV",
    "CL": "CL", "CALLE": "CL",
    "KR": "KR", "CRA": "KR", "CARRERA": "KR",
    "DG": "DG", "DIAGONAL": "DG",
    "TV": "TV", "TR": "TV", "TRANSVERSAL": "TV",
    "CQ": "CQ", "CIRCUNVALAR": "CQ",
}

NOMBRE_AVENIDA = {
    "BOYACA": "BOYACA", "CARACAS": "CARACAS", "NQS": "NQS",
    "DE LAS AMERICAS": "AMERICAS", "AMERICAS": "AMERICAS",
    "CIUDAD DE CALI": "CIUDAD DE CALI", "CIUDAD DE QUITO": "CIUDAD DE QUITO",
    "SUBA": "SUBA", "CENTENARIO": "CENTENARIO", "DEL SUR": "DEL SUR",
    "PRIMERO DE MAYO": "PRIMERO DE MAYO", "VILLAVICENCIO": "VILLAVICENCIO",
    "JIMENEZ": "JIMENEZ", "CHILE": "CHILE", "ROJAS": "ROJAS",
    "CIUDAD DE VILLAVICENCIO": "VILLAVICENCIO",
}

VIA_RE = re.compile(
    r"^(AV\s+AVENIDA|AVENIDA|AV|AK|AC|KR|CRA|CARRERA|CL|CALLE|DG|DIAGONAL|TV|TR|TRANSVERSAL|CQ|CIRCUNVALAR)\s*"
    r"([A-Z\s]*?)\s*(\d+)?\s*([A-Z])?\s*(BIS)?\s*(S|SUR)?\s*$"
)

NUM_RE = re.compile(r"(\d+)")


def normalizar_via(texto):
    if not texto:
        return None
    t = texto.strip().upper()
    t = re.sub(r"\s+", " ", t)
    for nombre in NOMBRE_AVENIDA:
        if nombre in t and re.match(r"^(AV\s+AVENIDA|AVENIDA|AV)\b", t):
            return {"tipo": "AV", "nombre": NOMBRE_AVENIDA[nombre], "numero": None, "letra": None, "sur": False}
    m = VIA_RE.match(t)
    if not m:
        nums = NUM_RE.findall(t)
        tipo_token = t.split(" ")[0]
        tipo = TIPOS.get(tipo_token)
        if tipo and nums:
            return {"tipo": tipo, "nombre": None, "numero": int(nums[0]), "letra": None, "sur": "S" in t.split(" ")[-2:]}
        return None
    tipo_token = m.group(1).replace(" ", "")
    tipo = TIPOS.get(tipo_token) or TIPOS.get(m.group(1).split(" ")[0])
    if tipo is None:
        return None
    numero = int(m.group(3)) if m.group(3) else None
    letra = m.group(4)
    sur = bool(m.group(6))
    return {"tipo": tipo, "nombre": None, "numero": numero, "letra": letra, "sur": sur}


def clave_via(via):
    if via is None:
        return None
    if via["nombre"]:
        return ("AV", via["nombre"])
    return (via["tipo"], via["numero"])


def parsear_direccion(direccion):
    if not isinstance(direccion, str):
        return None
    if "KM" in direccion.upper() and "-" not in direccion:
        return None
    partes = direccion.split("-", 1)
    if len(partes) != 2:
        return None
    izq, der = partes
    der = re.sub(r"\s*\d{1,2}\s*$", "", der.strip())
    via1 = normalizar_via(izq)
    via2 = normalizar_via(der)
    if via1 is None or via2 is None:
        return None
    return {"via1": via1, "via2": via2}


def clave_cruce(direccion):
    p = parsear_direccion(direccion)
    if p is None:
        return None
    k1, k2 = clave_via(p["via1"]), clave_via(p["via2"])
    if k1 is None or k2 is None:
        return None
    return tuple(sorted([k1, k2], key=lambda k: (str(k[0]), str(k[1]))))

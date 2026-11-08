import unicodedata


def strip_accents(s):
    if s is None:
        return ""
    nfkd = unicodedata.normalize("NFKD", str(s))
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def norm_text(s):
    return strip_accents(s).upper().strip()


def norm_gravedad(valor, es_codigo=False):
    codigo_map = {"1": "CON MUERTOS", "2": "CON HERIDOS", "3": "SOLO DANOS"}
    if es_codigo:
        return codigo_map.get(str(valor).strip(), None)
    txt = norm_text(valor)
    if "MUERT" in txt:
        return "CON MUERTOS"
    if "HERID" in txt:
        return "CON HERIDOS"
    if "DAÑ" in str(valor) or "DANO" in txt or "SOLO" in txt:
        return "SOLO DANOS"
    return None


def norm_flag(valor):
    return "SI" if norm_text(valor) == "SI" else "NO"


def norm_gravedad_persona(valor):
    txt = norm_text(valor)
    if "MUERT" in txt:
        return "MUERTO"
    if "HERID" in txt:
        return "HERIDO"
    if "ILES" in txt:
        return "ILESO"
    return "DESCONOCIDO"


def norm_condicion(valor):
    txt = norm_text(valor)
    if "CONDUCTOR" in txt:
        return "CONDUCTOR"
    if "MOTOCICLIST" in txt:
        return "MOTOCICLISTA"
    if "CICLIST" in txt:
        return "CICLISTA"
    if "PEATON" in txt:
        return "PEATON"
    if "PASAJERO" in txt or "ACOMPA" in txt:
        return "PASAJERO"
    return "OTRO"

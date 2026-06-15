"""Geography tables + resolution — verbatim port of the n8n 'Build Search Plan' node's
COUNTRY_ALIAS / REGION_CITIES / ZONE_CITIES / NATION_REGIONS literals and city logic.

PL and DE are fully hardcoded; any other country needs the Country Profiler (LLM) to
supply cities. Region spec resolution rules (per entry, comma/semicolon/newline split):
  'anywhere'              -> every city of every region (or all profiler cities)
  north/south/east/west/nearborder -> ZONE_CITIES[cc][zone] (or all profiler cities)
  voivodeship/Land key    -> REGION_CITIES[key] (diacritics-folded match)
  anything else           -> treated as a literal city name
"""
from __future__ import annotations

FOLD = {
    "ł": "l", "ą": "a", "ć": "c", "ę": "e", "ń": "n", "ó": "o", "ś": "s", "ź": "z",
    "ż": "z", "ä": "a", "ö": "o", "ü": "u", "ß": "ss", "é": "e", "è": "e", "á": "a",
    "í": "i",
}


def norm_city(s: object) -> str:
    t = str(s or "").lower().strip()
    r = "".join(FOLD.get(ch, ch) for ch in t)
    return "".join(ch for ch in r if ch.isalnum() and ch.isascii())


COUNTRY_ALIAS = {
    "de": "DE", "germany": "DE", "deutschland": "DE", "german": "DE", "ger": "DE",
    "pl": "PL", "poland": "PL", "polska": "PL", "polish": "PL", "pol": "PL",
}


def resolve_builtin(raw: object) -> str:
    k = str(raw or "").lower().strip()
    cc = COUNTRY_ALIAS.get(k, "")
    if not cc and k:
        cl = "".join(ch for ch in k if ch.isalpha())
        if cl.startswith("pol"):
            cc = "PL"
        elif cl.startswith(("ger", "deu")):
            cc = "DE"
    return cc


REGION_CITIES = {
    "dolnoslaskie": ["Wrocław", "Wałbrzych", "Legnica", "Jelenia Góra", "Lubin", "Głogów", "Świdnica"],
    "kujawskopomorskie": ["Bydgoszcz", "Toruń", "Włocławek", "Grudziądz", "Inowrocław"],
    "lubelskie": ["Lublin", "Zamość", "Chełm", "Biała Podlaska", "Puławy"],
    "lubuskie": ["Zielona Góra", "Gorzów Wielkopolski", "Nowa Sól", "Żary"],
    "lodzkie": ["Łódź", "Piotrków Trybunalski", "Pabianice", "Tomaszów Mazowiecki", "Bełchatów"],
    "malopolskie": ["Kraków", "Tarnów", "Nowy Sącz", "Oświęcim", "Chrzanów"],
    "mazowieckie": ["Warszawa", "Radom", "Płock", "Siedlce", "Pruszków", "Ostrołęka"],
    "opolskie": ["Opole", "Kędzierzyn-Koźle", "Nysa", "Brzeg"],
    "podkarpackie": ["Rzeszów", "Przemyśl", "Stalowa Wola", "Mielec", "Tarnobrzeg", "Krosno"],
    "podlaskie": ["Białystok", "Suwałki", "Łomża"],
    "pomorskie": ["Gdańsk", "Gdynia", "Słupsk", "Tczew", "Sopot"],
    "slaskie": ["Katowice", "Częstochowa", "Sosnowiec", "Gliwice", "Zabrze", "Bytom", "Bielsko-Biała"],
    "swietokrzyskie": ["Kielce", "Ostrowiec Świętokrzyski", "Starachowice", "Skarżysko-Kamienna"],
    "warminskomazurskie": ["Olsztyn", "Elbląg", "Ełk", "Ostróda"],
    "wielkopolskie": ["Poznań", "Kalisz", "Konin", "Piła", "Leszno", "Gniezno"],
    "zachodniopomorskie": ["Szczecin", "Koszalin", "Stargard", "Kołobrzeg", "Świnoujście"],
    "badenwurttemberg": ["Stuttgart", "Mannheim", "Karlsruhe", "Freiburg im Breisgau", "Heidelberg", "Heilbronn", "Ulm"],
    "bayern": ["München", "Nürnberg", "Augsburg", "Regensburg", "Würzburg", "Ingolstadt", "Fürth"],
    "berlin": ["Berlin"],
    "brandenburg": ["Potsdam", "Cottbus", "Brandenburg an der Havel", "Frankfurt (Oder)", "Oranienburg"],
    "bremen": ["Bremen", "Bremerhaven"],
    "hamburg": ["Hamburg"],
    "hessen": ["Frankfurt am Main", "Wiesbaden", "Kassel", "Darmstadt", "Offenbach am Main", "Gießen"],
    "mecklenburgvorpommern": ["Rostock", "Schwerin", "Neubrandenburg", "Stralsund", "Greifswald"],
    "niedersachsen": ["Hannover", "Braunschweig", "Osnabrück", "Oldenburg", "Wolfsburg", "Göttingen", "Hildesheim"],
    "nordrheinwestfalen": ["Köln", "Düsseldorf", "Dortmund", "Essen", "Duisburg", "Bochum", "Wuppertal", "Bonn"],
    "rheinlandpfalz": ["Mainz", "Ludwigshafen", "Koblenz", "Trier", "Kaiserslautern"],
    "saarland": ["Saarbrücken", "Neunkirchen", "Homburg", "Völklingen"],
    "sachsen": ["Dresden", "Leipzig", "Chemnitz", "Zwickau", "Görlitz", "Plauen"],
    "sachsenanhalt": ["Magdeburg", "Halle (Saale)", "Dessau-Roßlau", "Wittenberg"],
    "schleswigholstein": ["Kiel", "Lübeck", "Flensburg", "Neumünster", "Norderstedt"],
    "thuringen": ["Erfurt", "Jena", "Gera", "Weimar", "Gotha"],
    "niederschlesien": ["Wrocław", "Wałbrzych", "Legnica", "Jelenia Góra", "Lubin", "Głogów", "Świdnica"],
    "lowersilesia": ["Wrocław", "Wałbrzych", "Legnica", "Jelenia Góra", "Lubin", "Głogów", "Świdnica"],
}

ZONE_CITIES = {
    "DE": {
        "north": ["Hamburg", "Bremen", "Hannover", "Kiel", "Lübeck", "Rostock", "Oldenburg", "Bremerhaven"],
        "south": ["München", "Stuttgart", "Nürnberg", "Augsburg", "Karlsruhe", "Freiburg im Breisgau", "Ulm", "Regensburg"],
        "east": ["Berlin", "Leipzig", "Dresden", "Chemnitz", "Erfurt", "Jena", "Potsdam", "Cottbus"],
        "west": ["Köln", "Düsseldorf", "Dortmund", "Essen", "Frankfurt am Main", "Duisburg", "Bonn", "Wuppertal"],
        "nearborder": ["Frankfurt (Oder)", "Görlitz", "Cottbus", "Guben", "Bautzen", "Zittau"],
    },
    "PL": {
        "north": ["Gdańsk", "Gdynia", "Szczecin", "Olsztyn", "Koszalin", "Słupsk", "Elbląg"],
        "south": ["Kraków", "Katowice", "Wrocław", "Bielsko-Biała", "Rzeszów", "Opole", "Gliwice"],
        "east": ["Lublin", "Białystok", "Rzeszów", "Zamość", "Suwałki", "Przemyśl"],
        "west": ["Poznań", "Wrocław", "Zielona Góra", "Gorzów Wielkopolski", "Szczecin", "Kalisz"],
        "nearborder": ["Szczecin", "Zielona Góra", "Gorzów Wielkopolski", "Słubice", "Zgorzelec", "Jelenia Góra", "Świnoujście"],
    },
}

NATION_REGIONS = {
    "PL": ["dolnoslaskie", "kujawskopomorskie", "lubelskie", "lubuskie", "lodzkie", "malopolskie",
           "mazowieckie", "opolskie", "podkarpackie", "podlaskie", "pomorskie", "slaskie",
           "swietokrzyskie", "warminskomazurskie", "wielkopolskie", "zachodniopomorskie"],
    "DE": ["badenwurttemberg", "bayern", "berlin", "brandenburg", "bremen", "hamburg", "hessen",
           "mecklenburgvorpommern", "niedersachsen", "nordrheinwestfalen", "rheinlandpfalz",
           "saarland", "sachsen", "sachsenanhalt", "schleswigholstein", "thuringen"],
}

ZONES = ("north", "south", "east", "west", "nearborder")


def all_cities(cc: str) -> list[str]:
    out: list[str] = []
    for key in NATION_REGIONS.get(cc, []):
        out.extend(REGION_CITIES.get(key, []))
    return out


def resolve_cities(cc: str, region_spec: str, profiler_cities: list[str] | None) -> list[str]:
    """Resolve the campaign's region spec into a deduped city list."""
    entries = [e.strip() for e in _split(region_spec) if e.strip()]
    cities: list[str] = []
    for entry in entries:
        key = norm_city(entry)
        if key == "anywhere":
            cities.extend(all_cities(cc) if cc else (profiler_cities or []))
        elif key in ZONES:
            if cc:
                cities.extend(ZONE_CITIES.get(cc, {}).get(key, []))
            else:
                cities.extend(profiler_cities or [])
        elif key in REGION_CITIES:
            cities.extend(REGION_CITIES[key])
        else:
            cities.append(entry)  # literal city name
    seen: set[str] = set()
    out = []
    for c in cities:
        k = norm_city(c)
        if k and k not in seen:
            seen.add(k)
            out.append(c)
    return out


def ddg_kl(cc: str, iso2: str, lang_code: str) -> str:
    if cc == "PL":
        return "pl-pl"
    if cc == "DE":
        return "de-de"
    if iso2:
        return f"{iso2.lower()}-{lang_code}"
    return "wt-wt"


def _split(s: str) -> list[str]:
    out = [s]
    for sep in (",", ";", "\n"):
        out = [piece for chunk in out for piece in chunk.split(sep)]
    return out

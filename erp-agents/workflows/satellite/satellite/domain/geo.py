"""Region -> cities resolution for LEAD SATELLITE.

The AIM target dialog sets Country + Region. Region can be:
  - "Anywhere"/"nationwide" -> the WHOLE country: the LLM Country Profiler supplies its real
    regions + cities (pipeline). cities_for returns [] here so that dynamic path is used; the
    pipeline falls back to [country] only when the profiler is unreachable.
  - an explicit comma/semicolon list of city names ("Berlin, Munich") -> used verbatim (strict).
  - a single region/city name ("Mazowieckie", "Bratislava") -> used as a literal geo search term
    (no hardcoded region->city table; the search engine + profiler handle the expansion).
  - "" (empty) -> default_regions if any, else no cities.

Pure, no I/O. FULLY DYNAMIC / country-agnostic: there are NO hardcoded country/city/region tables
here — all real geography comes from the LLM profiler (clients/llm.profile_country).
"""
from __future__ import annotations

import re

# --- diacritic fold (matches models.norm_city, kept local to avoid an import cycle) ---
_FOLD = {
    "ł": "l", "ą": "a", "ć": "c", "ę": "e", "ń": "n", "ó": "o", "ś": "s",
    "ź": "z", "ż": "z", "ä": "a", "ö": "o", "ü": "u", "ß": "ss",
    "á": "a", "é": "e", "í": "i", "ő": "o", "ú": "u", "ű": "u",
}

# Words (any language) that mean "the whole country" — the AIM "Anywhere" option. Not country data.
_NATIONWIDE = {"anywhere", "any", "nationwide", "national", "alle", "wszedzie", "wszystkie",
               "cela", "celostatne", "egesz", "toata", "tsiala", "visa", "kogu", "cijela"}


def _norm_key(s: str) -> str:
    t = str(s or "").lower().strip()
    t = "".join(_FOLD.get(ch, ch) for ch in t)
    return re.sub(r"[^a-z0-9]", "", t)


def is_nationwide(region: str) -> bool:
    """True if the region means 'whole country' (the AIM 'Anywhere' option / nationwide)."""
    return _norm_key(region) in _NATIONWIDE


def _dedup_cities(cities) -> list[str]:
    out, seen = [], set()
    for c in cities or []:
        c = str(c).strip()
        if not c:
            continue
        # _norm_key strips non-Latin to "" (e.g. Cyrillic 'София'); fall back to the lowercased,
        # whitespace-stripped name so non-Latin city names are kept, not dropped.
        k = _norm_key(c) or re.sub(r"\s+", "", c.lower())
        if k and k not in seen:
            seen.add(k)
            out.append(c)
    return out


def cities_for(country: str, region: str, default_regions=None) -> list[str]:
    """Resolve (country, region) -> ordered, deduped city/geo terms — STRUCTURAL only (no country
    tables). Nationwide -> [] (the profiler supplies real cities). An explicit list -> verbatim. A
    single region/city name -> itself (a literal geo search term). See the module docstring."""
    reg = str(region or "").strip()

    # Nationwide: defer to the LLM profiler (pipeline). Empty list signals "use the dynamic path".
    if _norm_key(reg) in _NATIONWIDE:
        return []

    # Empty region: fall back to default_regions (used as literal geo terms), else nothing.
    if not reg:
        return _dedup_cities(default_regions or [])

    # An explicit "City, City" list is used strictly; a single token is used as one literal geo term.
    entries = [e.strip() for e in re.split(r"[,;\n]+", reg) if e.strip()]
    return _dedup_cities(entries)

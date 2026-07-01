"""Local geography lookup — the REAL city list per country+region, from GeoNames (built by
`build_geodata.py` into satellite/data/geodata.json). Replaces the LLM profiler's guessed,
capped city list for the nationwide sweep; the profiler still supplies the niche KEYWORDS.

Pure read-only. If the data file is absent the API degrades to empty/False so the pipeline
falls back to the profiler path (country-agnostic, no hard dependency).
"""
import json
import re
from functools import lru_cache
from pathlib import Path

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "geodata.json"

_FOLD = {
    "ł": "l", "ą": "a", "ć": "c", "ę": "e", "ń": "n", "ó": "o", "ś": "s", "ź": "z", "ż": "z",
    "ä": "a", "ö": "o", "ü": "u", "ß": "ss", "á": "a", "é": "e", "í": "i", "ő": "o", "ú": "u", "ű": "u",
}


def _norm(s: str) -> str:
    t = str(s or "").lower().strip()
    t = "".join(_FOLD.get(ch, ch) for ch in t)
    return re.sub(r"[^a-z0-9]", "", t)


@lru_cache(maxsize=1)
def _load() -> dict:
    try:
        return json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _resolve_cc(country: str) -> str:
    """'Germany' / 'Deutschland' / 'DE' -> 'DE'. '' if unknown."""
    data = _load()
    if not data:
        return ""
    c = str(country or "").strip()
    if len(c) == 2 and c.upper() in data:        # already an ISO2 code
        return c.upper()
    return (data.get("_countries") or {}).get(c.lower(), "")


def has_country(country: str) -> bool:
    """True if we have a real city list for this country (else the pipeline keeps the profiler path)."""
    return bool(_resolve_cc(country))


def regions(country: str) -> list[str]:
    """The country's admin-1 region names (voivodeships / Bundesländer / ...), data order."""
    cc = _resolve_cc(country)
    if not cc:
        return []
    return [r for r in _load().get(cc, {}) if r != "_countries"]


def cities_for_country(country: str, region: str | None = None, min_pop: int = 0,
                       limit: int | None = None) -> list[str]:
    """Real cities for (country[, region]) — biggest-population first, filtered by min_pop, capped by
    limit. region=None -> the WHOLE country (nationwide). Unknown country/region -> []."""
    cc = _resolve_cc(country)
    if not cc:
        return []
    cdata = _load().get(cc, {})

    if region:
        # EXACT region-name match only. Loose substring matching is wrong here: a zone word like
        # "North" would falsely match "North Rhine-Westphalia". Zones (North/South/…) are NOT real
        # regions — the pipeline detects them (geo.is_zone) and never calls this with a zone. An
        # unmatched region -> [] so the caller falls back to a literal geo search.
        want = _norm(region)
        pairs = []
        for rname, plist in cdata.items():
            if _norm(rname) == want:
                pairs.extend(plist)
        if not pairs:
            return []
    else:
        pairs = [p for plist in cdata.values() for p in plist]   # nationwide

    pairs = [p for p in pairs if (p[1] or 0) >= min_pop]
    pairs.sort(key=lambda x: x[1] or 0, reverse=True)
    names = [p[0] for p in pairs]
    return names[:limit] if limit else names


def region_batches(country: str, min_pop: int = 0, per_region_limit: int | None = None) -> list[tuple]:
    """Nationwide sweep helper: [(regionName, [cities biggest-first]), ...] for every region that has
    a town >= min_pop. Mirrors the pipeline's region-by-region batching (one query budget per region)."""
    cc = _resolve_cc(country)
    if not cc:
        return []
    out = []
    for rname, plist in _load().get(cc, {}).items():
        if rname == "_countries":
            continue
        ranked = sorted(plist, key=lambda x: x[1] or 0, reverse=True)
        cities = [p[0] for p in ranked if (p[1] or 0) >= min_pop]
        if cities:
            top_pop = ranked[0][1] or 0
            out.append((top_pop, rname, cities[:per_region_limit] if per_region_limit else cities))
    # Biggest regions first (by their largest city) so a max_regions cap keeps the populous ones
    # — that's where companies cluster, and it bounds query volume to dodge search rate-limits.
    out.sort(key=lambda x: x[0], reverse=True)
    return [(rname, cities) for _, rname, cities in out]

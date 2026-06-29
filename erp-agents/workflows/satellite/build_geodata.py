"""Build / refresh the LOCAL geography dataset from GeoNames (CC BY 4.0).

Why: the nationwide city list used to come from the LLM profiler (incomplete, can hallucinate,
capped). This pulls a REAL, complete, population-ranked city list per country+region so a sweep
covers the actual towns where companies sit — tunable by a population floor.

Source (official, updated daily): https://download.geonames.org/export/dump/
  - cities5000.txt  (towns >= 5000 pop; name + admin1 region + population)   [default]
  - cities1000.txt  (towns >= 1000 pop)  -> pass --tier cities1000 for deeper coverage
  - admin1CodesASCII.txt  (region code -> name: voivodeship / Bundesland / ...)
  - countryInfo.txt       (country name -> ISO2 code)

Output (committed, what the runtime loads):
  satellite/data/geodata.json       {cc: {regionName: [[city, pop], ... desc]}, "_countries": {name: cc}}
  satellite/data/geodata.meta.json  source URLs + Last-Modified + tier + counts (the VERSION stamp)

Usage:
  python build_geodata.py                 # download default tier (cities5000) + build
  python build_geodata.py --tier cities1000
  python build_geodata.py --check         # don't build; just say if GeoNames has a NEWER version
"""
import io
import json
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://download.geonames.org/export/dump"
DATA_DIR = Path(__file__).resolve().parent / "satellite" / "data"
META_PATH = DATA_DIR / "geodata.meta.json"
OUT_PATH = DATA_DIR / "geodata.json"


def _head_last_modified(url: str) -> str:
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.headers.get("Last-Modified", "")


def _get(url: str) -> tuple[bytes, str]:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read(), r.headers.get("Last-Modified", "")


def check() -> int:
    """Compare GeoNames' current Last-Modified to our stored meta. Exit 0 = up to date, 10 = newer
    available, 20 = never built."""
    if not META_PATH.exists():
        print("No local dataset yet (geodata.meta.json missing) — run without --check to build.")
        return 20
    meta = json.loads(META_PATH.read_text(encoding="utf-8"))
    tier = meta.get("tier", "cities5000")
    live = _head_last_modified(f"{BASE}/{tier}.zip")
    have = meta.get("cities_last_modified", "")
    print(f"tier={tier}\n  local Last-Modified:  {have or '(none)'}\n  GeoNames Last-Modified: {live or '(unknown)'}")
    if live and live != have:
        print("=> NEWER version available. Re-run `python build_geodata.py` to refresh.")
        return 10
    print("=> Up to date.")
    return 0


def build(tier: str) -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print(f"downloading {tier}.zip + admin1 + countryInfo from GeoNames ...", flush=True)
    cities_zip, cities_lm = _get(f"{BASE}/{tier}.zip")
    admin1_raw, _ = _get(f"{BASE}/admin1CodesASCII.txt")
    country_raw, _ = _get(f"{BASE}/countryInfo.txt")

    # admin1: "CC.code \t name \t asciiname \t geonameid"  -> {"CC.code": name}
    admin1 = {}
    for line in admin1_raw.decode("utf-8").splitlines():
        f = line.split("\t")
        if len(f) >= 2:
            admin1[f[0]] = f[1]

    # countryInfo: comment lines start with '#'; data cols: ISO, ISO3, ..., Country(name) at col 4
    countries = {}
    for line in country_raw.decode("utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        f = line.split("\t")
        if len(f) > 4 and f[0] and f[4]:
            countries[f[4].strip().lower()] = f[0]   # "germany" -> "DE"
    # handy aliases the satellite may pass
    countries.update({"uk": "GB", "united kingdom": "GB", "deutschland": "DE", "polska": "PL",
                      "österreich": "AT", "osterreich": "AT", "schweiz": "CH", "czechia": "CZ",
                      "czech republic": "CZ", "viet nam": "VN", "vietnam": "VN"})

    # cities5000/1000 cols: 1=name, 8=cc, 10=admin1 code, 14=population
    data: dict = {}
    n = 0
    for line in zipfile.ZipFile(io.BytesIO(cities_zip)).read(f"{tier}.txt").decode("utf-8").splitlines():
        f = line.split("\t")
        if len(f) < 15:
            continue
        name, cc, a1 = f[1], f[8], f[10]
        try:
            pop = int(f[14] or 0)
        except ValueError:
            pop = 0
        region = admin1.get(f"{cc}.{a1}", a1 or "—")
        data.setdefault(cc, {}).setdefault(region, []).append([name, pop])
        n += 1

    for cc in data:
        for region in data[cc]:
            data[cc][region].sort(key=lambda x: x[1], reverse=True)   # biggest towns first
    data["_countries"] = countries

    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    meta = {
        "source": "GeoNames (CC BY 4.0) — https://www.geonames.org/",
        "download": f"{BASE}/{tier}.zip",
        "tier": tier,
        "cities_last_modified": cities_lm,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "countries": len([k for k in data if k != "_countries"]),
        "cities": n,
    }
    META_PATH.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"built {OUT_PATH.name}: {meta['cities']} cities / {meta['countries']} countries "
          f"(tier={tier}, GeoNames {cities_lm})", flush=True)
    print(f"meta -> {META_PATH}", flush=True)
    return 0


def main(argv: list[str]) -> int:
    if "--check" in argv:
        return check()
    tier = "cities5000"
    if "--tier" in argv:
        tier = argv[argv.index("--tier") + 1]
    return build(tier)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

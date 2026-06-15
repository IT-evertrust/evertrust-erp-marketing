"""Niche keyword seeds + merge logic — verbatim port from 'Build Search Plan'.

Two seed pools: NICHE_KEYWORDS (English, keyed by normalized niche) and LOCAL_NICHES
(per-country local language, keyed by raw uppercased niche). The merged pool interleaves
local-first so query #1 per city uses the local-language term — local terms surface local
companies; English terms surface the bigger internationalized ones.
"""
from __future__ import annotations

NICHE_KEYWORDS = {
    "AIPLATFORM": "AI software, Machine Learning, Chatbot, Data Platform, Computer Vision, AI solution provider",
    "CYBERSECURITY": "Cybersecurity, SOC, SIEM, Penetration Testing, IT security, cloud security",
    "CLOUDINFRASTRUCTURE": "Cloud Hosting, Data Center, Managed Services, IaaS, cloud provider, MSP, colocation",
    "LIGHTINGELECTRICAL": "LED lighting, lighting manufacturer, electrical contractor",
    "MODULARRENTAL": "modular building, container rental, portable buildings",
    "SOLARENERGY": "solar EPC, battery storage, PV installer",
    "SOFTWAREDEVELOPMENT": "software house, software development company, IT services, custom software",
    "LED": "LED lighting, lighting supplier",
    "CONTAINER": "modular building, container rental",
    "PVBESSTRAFO": "PV installer, battery storage, transformer station",
    "CHARGINGPORT": "EV charging, charging infrastructure, wallbox",
    "CLEANINGSERVICE": "cleaning service, facility cleaning",
    "WAERMEPUMPE": "heat pump installer, heating",
    "DGUVV3INSPECTION": "electrical inspection, electrical safety testing",
}

LOCAL_NICHES = {
    "DE": {
        "LED": "LED Beleuchtung Hersteller Anbieter, Lichttechnik",
        "PV/BESS/TRAFO": "Photovoltaik Batteriespeicher Anbieter, PV-Anlage Installateur",
        "CONTAINER": "Container Modulbau Anbieter, Mietcontainer Buerocontainer",
        "CLEANING SERVICE": "Gebaeudereinigung Reinigungsfirma, Unterhaltsreinigung",
        "CHARGING PORT": "Ladestation Wallbox Anbieter, Ladeinfrastruktur",
        "DGUV V3 INSPECTION": "DGUV V3 Pruefung Elektropruefung",
        "WAERMEPUMPE": "Waermepumpe Installateur SHK, Heizung",
        "SOFTWARE DEVELOPMENT": "Softwareentwicklung, Software Agentur, IT Dienstleister",
        "CYBERSECURITY": "IT-Sicherheit, Cybersicherheit Anbieter",
        "CLOUD INFRASTRUCTURE": "Cloud Anbieter, Rechenzentrum, Managed Services",
        "SOLAR ENERGY": "Photovoltaik Anbieter, Solaranlage Installateur",
        "AI PLATFORM": "KI Software, Kuenstliche Intelligenz Anbieter",
    },
    "PL": {
        "LED": "oswietlenie LED producent dostawca, oprawy LED",
        "PV/BESS/TRAFO": "fotowoltaika magazyn energii instalator, stacja transformatorowa",
        "CONTAINER": "kontenery modulowe producent, kontenery biurowe",
        "CLEANING SERVICE": "firma sprzatajaca uslugi, sprzatanie biur",
        "CHARGING PORT": "stacja ladowania EV wallbox, ladowarki samochodowe",
        "DGUV V3 INSPECTION": "pomiary elektryczne SEP, przeglady instalacji",
        "WAERMEPUMPE": "pompa ciepla instalator, pompy ciepla montaz",
        "SOFTWARE DEVELOPMENT": "software house, tworzenie oprogramowania, firma programistyczna",
        "CYBERSECURITY": "cyberbezpieczenstwo, bezpieczenstwo IT firma",
        "CLOUD INFRASTRUCTURE": "chmura obliczeniowa dostawca, kolokacja serwerownia, uslugi IT",
        "SOLAR ENERGY": "fotowoltaika instalator, panele sloneczne firma",
        "AI PLATFORM": "sztuczna inteligencja firma, oprogramowanie AI",
    },
}


def norm_niche(niche: str) -> str:
    return "".join(ch for ch in niche.upper() if ch.isalnum() and ch.isascii())


def split_kw(s: object) -> list[str]:
    parts = []
    for chunk in str(s or "").replace(";", ",").split(","):
        chunk = chunk.strip()
        if chunk:
            parts.append(chunk)
    return parts


def merge_keywords(
    niche: str,
    cc: str,
    profiler_local: str = "",
    profiler_english: str = "",
) -> list[str]:
    """Local-first interleave of (local + profiler-local) with (english + profiler-english),
    deduped case-insensitively. Fallback when both pools are empty mirrors the n8n node."""
    seed_kw = NICHE_KEYWORDS.get(norm_niche(niche), "")
    local_kw = LOCAL_NICHES.get(cc, {}).get(niche.upper().strip(), "")
    local_arr = split_kw(local_kw) + split_kw(profiler_local)
    seed_arr = split_kw(seed_kw) + split_kw(profiler_english)

    merged: list[str] = []
    seen: set[str] = set()

    def push(k: str) -> None:
        kk = k.lower()
        if kk not in seen:
            seen.add(kk)
            merged.append(k)

    for i in range(max(len(local_arr), len(seed_arr))):
        if i < len(local_arr):
            push(local_arr[i])
        if i < len(seed_arr):
            push(seed_arr[i])
    if not merged:
        merged = [f"{niche.lower()} company", f"{niche.lower()} services provider"]
    return merged

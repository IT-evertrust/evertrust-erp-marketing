"""Lead Satellite deterministic helpers.

offline_leads builds plausible, campaign-specific prospect rows when no LLM/search
is available — pure function of the input (no randomness) so runs are reproducible.
plan_search_queries and dedup_leads are reused by both the LLM and offline paths.
"""

import re

from erp_agents.workflows.reach.lead_satellite.locale import LocaleProfile
from erp_agents.workflows.reach.lead_satellite.models import (
    LeadCandidate,
    LeadSatelliteInput,
)

# Deterministic name parts give variety without randomness (which would break
# reproducibility and resume). Index into these by lead number.
_PREFIXES = [
    "Rhein", "Nord", "Süd", "Alpen", "Berg", "Lindenhof", "Sonnen", "Adler",
    "Hanse", "Donau", "Main", "Eder", "Werra", "Isar", "Spree", "Neckar",
]
_SUFFIXES = ["GmbH", "AG", "KG", "Gruppe", "& Partner", "Holding"]


def slugify(value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return s or "company"


def plan_search_queries(
    data: LeadSatelliteInput, locale: LocaleProfile | None = None
) -> list[str]:
    """Build a locale-aware query plan from the AIM config.

    Geography/language come from `locale` (resolved from the AIM's country): native
    connective words and country-specific B2B directories, so we surface local SMEs
    instead of only English-ranked results. Deduped, order-preserving.
    """
    seg = f" {data.segment}" if data.segment else ""
    where = f"{data.region} {data.country}".strip()
    queries: list[str] = [
        f"{data.niche}{seg} {data.region}",
        f"{data.niche} {data.region}",
    ]
    if locale is not None:
        queries += [
            f"{data.niche}{seg} {locale.kw_company} {where}",
            f"{data.niche} {locale.kw_supplier} {data.region}",
            f"{data.segment or data.niche} {data.region} {locale.kw_contact}",
        ]
        # Bias a couple of queries toward structured B2B directories for that country.
        for directory in locale.directories[:2]:
            queries.append(f"{data.niche} {data.region} site:{directory}")
    else:
        queries.append(f"{data.niche} companies {where}")
    # Honor an explicit preferred source from the AIM, if any.
    if data.source:
        queries.append(f"{data.niche} {data.region} {data.source}")

    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        key = re.sub(r"\s+", " ", q).strip()
        if key and key.lower() not in seen:
            seen.add(key.lower())
            out.append(key)
    return out


def offline_leads(data: LeadSatelliteInput) -> list[LeadCandidate]:
    leads: list[LeadCandidate] = []
    niche_word = data.niche.split()[0] if data.niche else "Niche"
    for i in range(data.max_leads):
        prefix = _PREFIXES[i % len(_PREFIXES)]
        suffix = _SUFFIXES[i % len(_SUFFIXES)]
        company = f"{prefix} {niche_word} {suffix}"
        domain = f"{slugify(prefix + '-' + niche_word)}.de"
        leads.append(
            LeadCandidate(
                company=company,
                website=f"https://www.{domain}",
                contact_name=None,
                contact_title="Managing Director",
                email=f"info@{domain}",
                phone=None,
                location=data.region,
                source=data.source or "offline",
                qualification_reason=(
                    f"{data.niche} operator in {data.region}"
                    + (f" ({data.segment})" if data.segment else "")
                ),
                # Decreasing confidence down the list — best fits first.
                confidence=round(max(0.4, 0.85 - i * 0.03), 2),
            )
        )
    return leads


def dedup_leads(leads: list[LeadCandidate]) -> list[LeadCandidate]:
    seen: set[str] = set()
    unique: list[LeadCandidate] = []
    for lead in leads:
        key = (lead.email or lead.website or lead.company).strip().lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(lead)
    return unique

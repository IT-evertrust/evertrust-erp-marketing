"""Lead Satellite deterministic helpers.

offline_leads builds plausible, campaign-specific prospect rows when no LLM/search
is available — pure function of the input (no randomness) so runs are reproducible.
plan_search_queries and dedup_leads are reused by both the LLM and offline paths.
"""

import re

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


def plan_search_queries(data: LeadSatelliteInput) -> list[str]:
    seg = f" {data.segment}" if data.segment else ""
    return [
        f"{data.niche}{seg} {data.region}",
        f"{data.niche} companies {data.region} {data.country}",
        f"{data.segment or data.niche} {data.region} contact email",
    ]


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

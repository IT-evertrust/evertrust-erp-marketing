"""Merge & validate — port of 'Merge & Validate Leads'. Pure logic, fully testable.

The ID-join anti-fabrication core: the model's output is joined back to the REAL
candidate set by id. Unknown ids are fabrications and are dropped. Every trusted field
(domain, website, email pool, hits, fallback city/name) comes from the candidate record;
the model's email is accepted only if it is literally in the harvested set.

Filter chain order (verbatim): unknown id -> dup domain -> isCompany false ->
nicheMatch false -> empty name -> dup normalized name -> NICHE_BLOCK on name+type ->
stated employees < 20 (DROP_TIER_C; unstated = keep).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from .serp import NICHE_BLOCK, Candidate

TIER_RANK = {"B": 1, "A": 2, "AAA": 3}
MIN_COMPANY_AGE_YEARS = 12


@dataclass
class LeadRow:
    company_name: str
    company_type: str
    email: str
    status: str  # '' | 'PROTECTED' | 'NO_EMAIL'
    website: str
    city: str
    country: str
    tier: str
    score: float = 0.0


@dataclass
class ValidationStats:
    returned: int = 0
    fabricated: int = 0
    dropped: dict = field(default_factory=lambda: {
        "not_company": 0, "niche": 0, "no_name": 0, "dup": 0, "blocklist": 0, "tier_c": 0,
    })


def parse_emp_max(v: object) -> int:
    if isinstance(v, (int, float)):
        return int(v)
    nums = re.findall(r"[0-9]+", str(v or ""))
    return max((int(n) for n in nums), default=0)


def parse_founded_year(v: object, current_year: int) -> int:
    m = re.search(r"(1[6789][0-9][0-9])|(20[0-9][0-9])", str(v or ""))
    if m:
        y = int(m.group(0))
        if 1500 < y <= current_year:
            return y
    return 0


def size_tier(n: int) -> str:
    if n >= 350:
        return "AAA"
    if n >= 75:
        return "A"
    if n >= 20:
        return "B"
    return ""


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def merge_validate(
    companies: list[dict],
    by_id: dict[str, Candidate],
    *,
    parsed_chunks: int,
    failed_chunks: int,
    today: date | None = None,
    log=print,
) -> tuple[list[LeadRow], ValidationStats]:
    current_year = (today or date.today()).year
    stats = ValidationStats(returned=len(companies))
    seen_domains: set[str] = set()
    seen_names: set[str] = set()
    rows: list[LeadRow] = []

    for comp in companies:
        cand = by_id.get(str(comp.get("id", "")))
        if cand is None:
            stats.fabricated += 1
            continue
        if cand.domain in seen_domains:
            stats.dropped["dup"] += 1
            continue
        if comp.get("isCompany") is False:
            stats.dropped["not_company"] += 1
            continue
        if comp.get("nicheMatch") is not True:
            stats.dropped["niche"] += 1
            continue
        name = str(comp.get("name") or "").strip() or cand.name_guess
        if not name:
            stats.dropped["no_name"] += 1
            continue
        nk = _norm_name(name)
        if nk in seen_names:
            stats.dropped["dup"] += 1
            continue
        hay = (name + " " + str(comp.get("companyType") or "")).lower()
        if any(b in hay for b in NICHE_BLOCK):
            stats.dropped["blocklist"] += 1
            continue
        emp = parse_emp_max(comp.get("employeeCount"))
        if 0 < emp < 20:
            stats.dropped["tier_c"] += 1
            continue

        seen_domains.add(cand.domain)
        seen_names.add(nk)

        founded = parse_founded_year(comp.get("foundedYear"), current_year)
        age_tier = "B" if founded and (current_year - founded) >= MIN_COMPANY_AGE_YEARS else ""
        tier = max(size_tier(emp), age_tier, key=lambda t: TIER_RANK.get(t, 0))

        # email: model's pick only if literally harvested; else first harvested; else ''
        model_email = str(comp.get("email") or "").strip()
        email = model_email if model_email in cand.emails else (cand.emails[0] if cand.emails else "")
        status = "" if email else ("PROTECTED" if cand.cf_protected else "NO_EMAIL")

        row = LeadRow(
            company_name=name[:120],
            company_type=str(comp.get("companyType") or "")[:80],
            email=email,
            status=status,
            website=f"https://{cand.domain}/",
            city=(str(comp.get("city") or "").strip() or cand.city)[:60],
            country=cand.country,
            tier=tier,
        )
        row.score = TIER_RANK.get(tier, 0) * 100 + (10 if email else 0) + cand.hits
        rows.append(row)

    if not rows:
        raise SystemExit(
            f"V2 ZERO LEADS: {len(by_id)} candidates -> 0 kept "
            f"(parsedChunks={parsed_chunks} failedChunks={failed_chunks} "
            f"dropNiche={stats.dropped['niche']}). Gateway down or niche filter too strict."
        )
    rows.sort(key=lambda r: -r.score)
    log(f"[V2 Validate] {stats.returned} returned -> {len(rows)} kept "
        f"(fabricated={stats.fabricated} dropped={stats.dropped})")
    return rows, stats

"""Firmographic extraction for the C-TIER rescue/filter — pulls a company's FOUNDING YEAR and
EMPLOYEE COUNT out of its already-crawled page text (no extra I/O, no LLM). Bilingual (German +
English), regex-only, pure → unit-testable.

Used to refine tier-C companies (the bottom of the relevance score): a company that is positively
TOO YOUNG (age < AGE_MIN) or TOO SMALL (employees < EMP_MIN) is rejected; a C-tier company that
shows a qualifying signal (old enough or sizeable) with no disqualifier is promoted to B. When the
page states neither, the verdict is 'keep' (leave the tier as-is) — we never punish missing data.

Interim heuristic — the full revenue/Northdata tier comes later; AGE_MIN/EMP_MIN are tunable.
"""
from __future__ import annotations

import datetime
import re

AGE_MIN = 7      # founded < 7 years ago -> too young
EMP_MIN = 10     # fewer than 10 staff -> too small (tune later)

# "gegründet 1998", "gegr. im Jahr 1998", "seit 1995", "since 1990", "founded in 2001",
# "established 1987", "est. 1990", "Gründungsjahr 1975". A founding keyword must precede the year,
# so a bare "© 2024" / address year never matches. Year constrained to 1850..2099.
_FOUNDED_RE = re.compile(
    r"(?:gegr[üu]ndet|gegr\.|seit|since|founded(?:\s+in)?|established|est\.?|gr[üu]ndungsjahr)"
    r"\W{0,14}(18[5-9]\d|19\d{2}|20\d{2})",
    re.I,
)
# "200 Mitarbeiter", "über 120 Beschäftigte", "rund 50 Angestellte", "30 employees", "team of 30".
_EMP_BEFORE_RE = re.compile(
    r"(\d[\d.,]{0,6})\s*\+?\s*(?:mitarbeiter(?:innen|n)?|mitarbeitende[nr]?|besch[äa]ftigte[nr]?|"
    r"angestellte[nr]?|employees|staff|belegschaft|team\s+of)\b",
    re.I,
)
# "Mitarbeiter: 200", "Belegschaft von 500", "team: 30", "employees: 150".
_EMP_AFTER_RE = re.compile(
    r"(?:mitarbeiter(?:innen|n)?|besch[äa]ftigte[nr]?|angestellte[nr]?|employees|staff|belegschaft|"
    r"team)\W{0,6}(?:von\s+|of\s+|:\s*|rund\s+|ca\.?\s+|über\s+|approx\.?\s+)?(\d[\d.,]{0,6})\b",
    re.I,
)


def _to_int(s: str) -> int:
    return int(re.sub(r"[.,]", "", s))


def extract_firmographics(text: str, *, current_year: int | None = None) -> dict:
    """Return {foundedYear, age, employees} from page text; any field is None when not stated."""
    t = text or ""
    years = [int(y) for y in _FOUNDED_RE.findall(t)]
    founded = min(years) if years else None     # earliest founding-keyword year = the founding year
    emps = [_to_int(m) for m in _EMP_BEFORE_RE.findall(t)] + [_to_int(m) for m in _EMP_AFTER_RE.findall(t)]
    emps = [e for e in emps if 1 <= e <= 1_000_000]
    employees = max(emps) if emps else None     # take the largest stated headcount
    cy = current_year or datetime.date.today().year
    age = (cy - founded) if founded else None
    return {"foundedYear": founded, "age": age, "employees": employees}


def firmographic_verdict(fg: dict, *, age_min: int = AGE_MIN, emp_min: int = EMP_MIN) -> str:
    """'reject' (positively too young/small), 'promote' (a qualifying signal + no disqualifier),
    or 'keep' (nothing stated → leave the tier unchanged)."""
    age, emp = fg.get("age"), fg.get("employees")
    if (age is not None and age < age_min) or (emp is not None and emp < emp_min):
        return "reject"
    if (age is not None and age >= age_min) or (emp is not None and emp >= emp_min):
        return "promote"
    return "keep"

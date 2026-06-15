"""NO_EMAIL second pass — port of 'Collect Missing Emails' / 'Search Missing Emails' /
'Apply Recovered Emails'. Pure regex over SERP bodies (no LLM, no page fetch).

Acceptance rule (verbatim): an email found on the SERP is accepted only if its domain
contains the company's domain stem, or — fallback — the first 8 alphanumeric chars of
the company name (minimum 4). Successful recovery clears the row's status to ''.
"""
from __future__ import annotations

import re
import time

import httpx

from .emails import EMAIL_RE, clean_email
from .plan import Plan
from .serp import build_url
from .settings import ACCEPT_LANG, UA, Settings
from .validate import LeadRow

MAX_RECOVERY_QUERIES = 150
EXTRA_BAD = ("mojeek", "duckduckgo")


def recover_missing_emails(
    rows: list[LeadRow], plan: Plan, settings: Settings, log
) -> int:
    targets = [(i, r) for i, r in enumerate(rows) if not r.email][:MAX_RECOVERY_QUERIES]
    if not targets:
        return 0

    headers = {"User-Agent": UA, "Accept-Language": ACCEPT_LANG}
    recovered = 0
    with httpx.Client(headers=headers, follow_redirects=True) as client:
        for n, (idx, row) in enumerate(targets):
            dom = re.sub(r"^https?://", "", row.website).replace("www.", "").split("/")[0]
            query = f'"{row.company_name}" {dom} email'
            engine = plan.engines[n % len(plan.engines)]
            url = build_url(engine, query, searxng_url=settings.searxng_url,
                            lang_code=plan.lang_code, ddg_kl=plan.ddg_kl)
            try:
                body = client.get(url, timeout=settings.serp_timeout_s).text
            except httpx.HTTPError:
                body = ""

            found: list[str] = []
            for m in EMAIL_RE.findall(body or ""):
                e = clean_email(m, extra_bad=EXTRA_BAD)
                if e and e not in found:
                    found.append(e)

            pick = _pick_email(found, dom, row.company_name)
            if pick:
                rows[idx].email = pick
                rows[idx].status = ""
                recovered += 1
            if n + 1 < len(targets):
                time.sleep(settings.serp_delay_s)

    log(f"[V2 EmailSearch] {len(targets)} recovery queries -> {recovered} recovered")
    return recovered


def _pick_email(found: list[str], dom: str, name: str) -> str:
    dom_key = (dom or "").split(".")[0]
    name_key = re.sub(r"[^a-z0-9]", "", (name or "").lower())[:8]
    for e in found:
        ed = e.split("@")[1] if "@" in e else ""
        if dom_key and dom_key in ed:
            return e
    if len(name_key) >= 4:
        for e in found:
            ed = re.sub(r"[^a-z0-9]", "", (e.split("@")[1] if "@" in e else ""))
            if name_key in ed:
                return e
    return ""

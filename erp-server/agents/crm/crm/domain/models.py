"""Domain models + pure logic for CRM Customer, ported from n8n workflow vNCqzVjOOhSD2Czb
(EVERTRUST - CRM Customer (PG)).

CRM scans active campaigns and: (intake) promotes Interested/Meeting prospects to hot-leads;
(graduation) turns signed-contract companies into customers (unless already a customer). Signing
comes from /contracts (written by ContractMaker). The compute is pure + unit-testable.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Campaign:
    campaign_id: str
    campaign_name: str = ""
    niche: str = ""
    prospects: list = field(default_factory=list)   # raw prospect dicts
    signed_keys: set = field(default_factory=set)    # normalized company keys with a SIGNED contract


def norm_company(s: str) -> str:
    """Normalize a company name to a comparison key (port of the JS `norm`)."""
    x = unicodedata.normalize("NFD", str(s or "").lower())
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    for token in ("sp. z o.o.", "sp.z o.o.", "sp z o o", "gmbh"):
        x = x.replace(token, " ")
    return re.sub(r"[^a-z0-9]", "", x)


def signed_keys_from(contracts: list[dict]) -> set[str]:
    keys = set()
    for c in contracts:
        raw = c.get("companyKey") or c.get("company_key") or c.get("companyName") or c.get("company_name") or ""
        k = norm_company(raw)
        if k:
            keys.add(k)
    return keys


def _g(p: dict, *keys, default=""):
    for k in keys:
        v = p.get(k)
        if v not in (None, ""):
            return v
    return default


def is_intake_status(status: str) -> bool:
    sl = str(status or "").strip().lower()
    return sl.startswith("interested") or sl.startswith("meeting")


def compute_rows(campaigns: list[Campaign], customer_emails: set[str], now_iso: str) -> list[dict]:
    """Returns the upsert rows: {_t:'hot'|'cust', ...} — verbatim port of 'Compute Intake + Graduate'."""
    out: list[dict] = []
    grad_seen: set[str] = set()
    for camp in campaigns:
        signed = camp.signed_keys or set()
        seen: set[str] = set()
        for p in camp.prospects or []:
            email = str(_g(p, "email", "prospectEmail", "Email")).strip()
            if not email:
                continue
            key = email.lower()
            if key in seen:
                continue
            status = str(_g(p, "status", "Status")).strip()
            if not is_intake_status(status):
                continue
            seen.add(key)
            company = str(_g(p, "companyName", "company", "Company Name"))
            ck = norm_company(company)
            is_signed = ck in signed
            stage = "MeetingScheduled" if status.lower().startswith("meeting") else "Interested"
            out.append({
                "_t": "hot", "campaignId": camp.campaign_id,
                "prospectId": _g(p, "id", "prospectId", default=""), "companyName": company,
                "companyType": _g(p, "companyType", "Company Type"), "email": email,
                "website": _g(p, "website"), "city": _g(p, "city"), "country": _g(p, "country"),
                "tier": _g(p, "tier"), "niche": camp.niche or _g(p, "niche"),
                "sourceCampaign": camp.campaign_name,
                "hotReason": "Signed" if is_signed else stage, "leadStatus": status,
                "detectedAt": now_iso, "contractStatus": "Signed" if is_signed else "",
            })
            if is_signed and key not in customer_emails and key not in grad_seen:
                grad_seen.add(key)
                out.append({
                    "_t": "cust", "companyName": company,
                    "companyType": _g(p, "companyType", "Company Type"), "email": email,
                    "country": _g(p, "country"), "niche": camp.niche, "sourceCampaign": camp.campaign_name,
                    "stage": "Customer", "hotReason": "Signed", "createdAt": now_iso, "contractStatus": "Signed",
                })
    return out

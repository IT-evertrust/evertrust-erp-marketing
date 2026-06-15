"""CRM state machine — pure logic, verbatim port of 'Compute Intake + Graduate'.

Intake: a lead qualifies if Status (lowercased) STARTS WITH 'interested' or 'meeting'
(prefix match, NOT equality — '"Meeting Schedule"' without the 'd' qualifies, per n8n).
Graduation: ONLY when a meeting for that company has a signing (sign_now true) — never on
'Meeting Scheduled' alone. Lead↔meeting matching is by normalized company name.
"""
from __future__ import annotations

import re
import unicodedata

_LEGAL_FORMS = ["sp. z o.o.", "sp.z o.o.", "sp z o o", "gmbh"]


def norm(name: str) -> str:
    x = unicodedata.normalize("NFD", (name or "").lower())
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    for f in _LEGAL_FORMS:
        x = x.replace(f, " ")
    return re.sub(r"[^a-z0-9]", "", x)


def qualifies(status: str) -> bool:
    s = (status or "").strip().lower()
    return s.startswith("interested") or s.startswith("meeting")


def hot_reason(status: str) -> str:
    return "MeetingScheduled" if (status or "").strip().lower().startswith("meeting") else "Interested"


def meetings_note(meetings: list[dict]) -> str:
    """The n8n sheet kept Meeting 1-5 columns, but the live hot_leads table collapsed them
    to a single `final_meeting` + `note`. Preserve the history as a compact joined summary
    in `note` (first 5 meetings) so nothing is lost."""
    labels = []
    for m in meetings[:5]:
        outcome = m.get("meeting_outcome") or m.get("title") or ""
        label = f"{m.get('meeting_date','')}: {outcome}".strip(": ")[:300]
        if label:
            labels.append(label)
    return " | ".join(labels)


def find_signing(meetings: list[dict]) -> dict | None:
    """First meeting with a signing. Our meetings table stores sign_now as a boolean."""
    for m in meetings:
        if m.get("sign_now") is True or str(m.get("sign_now", "")).strip().upper() in ("YES", "TRUE"):
            return m
    return None


def compute(campaign: dict, leads: list[dict], meetings_by_key: dict[str, list[dict]],
            existing_customer_emails: set[str]) -> tuple[list[dict], list[dict]]:
    """Return (hot_rows, customer_rows) for one campaign."""
    hot_rows: list[dict] = []
    cust_rows: list[dict] = []
    seen_emails: set[str] = set()
    graduated: set[str] = set()

    for lead in leads:
        status = lead.get("status", "")
        if not qualifies(status):
            continue
        email = (lead.get("email") or "").strip()
        ekey = email.lower()
        if not email or ekey in seen_emails:
            continue
        seen_emails.add(ekey)

        meetings = meetings_by_key.get(norm(lead.get("company_name", "")), [])
        signed = find_signing(meetings)

        hot_rows.append({
            "campaign_id": campaign["id"],
            "lead_id": lead.get("lead_id") or lead.get("id"),
            "company_name": lead.get("company_name", ""), "company_type": lead.get("company_type", ""),
            "email": email, "website": lead.get("website", ""), "city": lead.get("city", ""),
            "country": lead.get("country", ""), "tier": lead.get("tier", ""),
            "niche": campaign.get("niche", ""), "source_campaign": campaign.get("project", ""),
            "hot_reason": hot_reason(status), "meeting_date": (signed or {}).get("meeting_date", ""),
            "lead_status": status, "note": meetings_note(meetings),
            "final_meeting": f"Signed {signed['meeting_date']}" if signed else "",
            "contract_status": "Signed" if signed else "",
        })

        if signed and ekey not in existing_customer_emails and ekey not in graduated:
            graduated.add(ekey)
            cust_rows.append({
                "company_name": lead.get("company_name", ""), "company_type": lead.get("company_type", ""),
                "email": email, "website": lead.get("website", ""), "city": lead.get("city", ""),
                "country": lead.get("country", ""), "tier": lead.get("tier", ""),
                "niche": campaign.get("niche", ""), "source_campaign": campaign.get("project", ""),
                "stage": "Customer", "hot_reason": "Signed", "contract_status": "Signed",
                "owner": "", "notes": "",
                "meeting_date": signed.get("meeting_date", ""),
                "cooperation_term": (signed.get("cooperation_term") or "").strip(),
            })
    return hot_rows, cust_rows

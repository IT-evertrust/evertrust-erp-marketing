"""Port of the 'Extract Unsure Leads' + 'Cap Per Run' n8n code nodes.

Pure: takes already-fetched lead rows (dict-like) + a campaign dict, returns UnsureLead
objects. Filter status=='unsure' (trim/lower), validate email, dedupe by email, route
inbox. No I/O."""
from __future__ import annotations

import re

from .enums import route_inbox
from .models import UnsureLead

# Reused email regex (verbatim from both n8n code nodes).
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def _first(row: dict, *keys: str) -> object:
    """Tolerate the many header-case variants the n8n nodes tried (Status|status, etc.)."""
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
    return ""


def extract_email(value: object) -> str | None:
    m = EMAIL_RE.search(str(value or ""))
    return m.group(0).lower() if m else None


def extract_unsure_leads(rows: list[dict], campaign: dict) -> list[UnsureLead]:
    """Filter the campaign's lead rows to deduped, email-valid, unsure leads."""
    campaign_id = campaign.get("id", 0)
    campaign_name = campaign.get("name", "") or ""

    out: list[UnsureLead] = []
    seen: set[str] = set()
    for row in rows:
        status = str(_first(row, "Status", "status")).strip().lower()
        if status != "unsure":
            continue
        email = extract_email(_first(row, "Email", "email"))
        if not email:
            continue
        if email in seen:
            continue
        seen.add(email)

        send_from = _first(row, "Send From", "Sent From", "send_from", "sentFrom")
        out.append(UnsureLead(
            lead_email=email,
            company_name=str(_first(row, "Company Name", "company_name", "companyName")),
            country=str(_first(row, "Country", "country")),
            campaign_id=campaign_id,
            campaign_name=campaign_name,
            sent_from=route_inbox(send_from),
            lead_id=int(row.get("id") or 0),
        ))
    return out


def cap(leads: list[UnsureLead], limit: int) -> list[UnsureLead]:
    """'Cap Per Run' — at most `limit` leads processed per execution."""
    return leads[:limit]

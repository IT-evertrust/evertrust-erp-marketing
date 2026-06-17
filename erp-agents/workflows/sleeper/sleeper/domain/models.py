"""Domain models for SLEEPER GRENADE, aligned to n8n workflow cZDGIoudM6yg17kV
(EVERTRUST - SLEEPER GRENADE (PG)).

Sleeper sweeps snooze-due prospects: do-not-contact ones become a suppression + DO_NOT_CONTACT
(row kept, never deleted); the rest get an AI re-engage draft → send → RE_ENGAGED. The snooze
date math is done server-side by the ERP (GET /prospects?snoozeDue=true).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Prospect:
    id: str
    email: str
    company_name: str = ""
    first_name: str = ""
    status: str = ""
    do_not_contact: bool = False
    followup_count: int = 0


@dataclass(frozen=True)
class ReengageDraft:
    subject: str
    body: str


def to_prospect(x: dict) -> Prospect:
    return Prospect(
        id=str(x.get("id") or ""),
        email=str(x.get("email") or ""),
        company_name=str(x.get("companyName") or x.get("company_name") or ""),
        first_name=str(x.get("firstName") or x.get("first_name") or ""),
        status=str(x.get("status") or ""),
        do_not_contact=bool(x.get("doNotContact") or x.get("do_not_contact") or False),
        followup_count=int(x.get("followupCount") or x.get("followup_count") or 0),
    )


def parse_draft(text: str) -> ReengageDraft:
    """Robustly extract {subject, body} from the model output — fail loud (port of Parse Draft)."""
    raw = str(text or "").strip()
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    data = None
    try:
        data = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        a, b = cleaned.find("{"), cleaned.rfind("}")
        if a != -1 and b > a:
            try:
                data = json.loads(cleaned[a : b + 1])
            except json.JSONDecodeError:
                data = None
    if not isinstance(data, dict):
        raise ValueError(f"Sleeper: AI draft is not valid JSON: {cleaned[:200]}")
    subject = str(data.get("subject") or "").strip()
    body = str(data.get("body") or "").strip()
    if not subject or not body:
        raise ValueError("Sleeper: AI draft missing subject or body")
    return ReengageDraft(subject=subject, body=body)

"""Domain models — ERP edition.

Reach now reads/writes the EVERTRUST ERP machine API (prospects/campaigns/outreach),
not Neon. So the lead row becomes a `Prospect` (ERP shape, status enum + followupCount)
and templates come from the campaign config as named strings.
Contract: AGENT-BLUEPRINTS/REACH-ERP-CONTRACT.md.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Campaign:
    id: str
    name: str = ""
    project: str = ""
    country: str = ""
    region: str = ""
    sender: str = "info"  # 'info' | 'hanna' (Gmail routing key)
    niche: str = ""

    @property
    def city(self) -> str:
        # ERP has no explicit city for the campaign; region is the closest carrier and
        # is what the LLM prompt exposes as {{city}} (matches the n8n behaviour).
        return self.region


@dataclass(frozen=True)
class Prospect:
    """One ERP prospect row (GET /prospects)."""

    id: str
    email: str
    company_name: str = ""
    website: str = ""
    city: str = ""
    country: str = ""
    status: str = "NEW"  # NEW | EMAILED | REPLIED | RE_ENGAGED | ...
    followup_count: int = 0
    last_contacted_at: str | None = None


@dataclass(frozen=True)
class Template:
    subject: str
    body: str

    @property
    def is_empty(self) -> bool:
        return not (self.subject.strip() or self.body.strip())


@dataclass(frozen=True)
class Action:
    """Outcome of the decision matrix for one prospect."""

    action_type: str  # 'cold' | 'followup' | 'finalpush' | 'skip'
    template_key: str | None = None  # the campaign.templates key to use
    skip_reason: str = ""  # 'INVALID_EMAIL' | 'NO_TEMPLATE'


@dataclass(frozen=True)
class Validation:
    """LLM (or offline) personalization result — mirrors the n8n JSON contract."""

    valid: bool
    reason: str
    final_subject: str
    final_body: str


@dataclass
class RunCounts:
    cold: int = 0
    followup: int = 0
    finalpush: int = 0
    skipped: int = 0
    invalid: int = 0

    @property
    def emails_sent(self) -> int:
        return self.cold + self.followup + self.finalpush

    def as_dict(self) -> dict:
        return {
            "cold": self.cold,
            "followup": self.followup,
            "finalpush": self.finalpush,
            "skipped": self.skipped,
            "invalid": self.invalid,
        }


_SUBJECT_RE = re.compile(r"^\s*subject\s*:\s*(.*)$", re.IGNORECASE)


def parse_template(raw: str, campaign: Campaign) -> Template:
    """ERP campaign.templates values are single strings. Support an optional leading
    'Subject:' line; otherwise synthesise a personalisable default subject so the LLM
    (or offline fill) still produces one."""
    raw = raw or ""
    lines = raw.splitlines()
    if lines:
        m = _SUBJECT_RE.match(lines[0])
        if m:
            body = "\n".join(lines[1:]).lstrip("\n")
            if body[:5].lower() == "body:":
                body = body.split(":", 1)[1].lstrip()
            return Template(m.group(1).strip(), body)
    default_subject = "{{companyName}} — German public tender opportunity"
    return Template(default_subject, raw)

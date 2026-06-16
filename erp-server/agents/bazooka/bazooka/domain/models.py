"""Domain models — ERP edition, aligned to n8n workflow zyCTVLpZj3YyR2qV
(EVERTRUST - REACH BAZOOKA (PG) v2).

Templates come from the ERP campaign config as a single `templates.coldEmail` string
holding [COLD]/[COLD-AGG]/[FOLLOWUP]/[FINALPUSH] blocks (each Subject:/Body:); news from
`templates.newsBrief`. A prospect is the ERP /prospects row.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# template block names, matching the n8n workflow
BLOCKS = ("COLD", "COLD-AGG", "FOLLOWUP", "FINALPUSH")


@dataclass(frozen=True)
class Campaign:
    id: str
    name: str = ""
    project: str = ""
    country: str = ""
    region: str = ""
    sender: str = "info"  # 'info' | 'hanna'
    niche: str = ""

    @property
    def city(self) -> str:
        return self.region


@dataclass(frozen=True)
class Prospect:
    """One ERP prospect row (GET /prospects)."""

    id: str
    email: str
    company_name: str = ""
    company_type: str = ""
    website: str = ""
    city: str = ""
    country: str = ""
    status: str = "NEW"  # NEW | EMAILED | REPLIED | RE_ENGAGED | CONTACTED | ...
    followup_count: int = 0
    last_contacted_at: str | None = None


@dataclass(frozen=True)
class Template:
    subject: str
    body: str

    @property
    def is_empty(self) -> bool:
        return not (self.subject.strip() or self.body.strip())


# block name -> Template
Templates = dict[str, Template]


@dataclass(frozen=True)
class News:
    body: str = ""
    is_bad_news: bool = False


@dataclass(frozen=True)
class Action:
    action_type: str  # 'cold' | 'followup' | 'finalpush' | 'skip'
    template_block: str | None = None  # 'COLD' | 'COLD-AGG' | 'FOLLOWUP' | 'FINALPUSH'
    skip_reason: str = ""  # 'INVALID_EMAIL'


@dataclass(frozen=True)
class Validation:
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


# --- template / news parsing (ports the n8n "Parse Template Blocks" / "Parse News") ----

def _extract_block(text: str, tag: str) -> Template:
    pattern = re.compile(
        r"\[" + tag + r"\]([\s\S]*?)(?=\n\[(?:COLD-AGG|COLD|FOLLOWUP|FINALPUSH)\]|$)",
        re.IGNORECASE,
    )
    m = pattern.search(text)
    if not m:
        return Template("", "")
    raw = m.group(1)
    subj = re.search(r"Subject:\s*(.+)", raw, re.IGNORECASE)
    body = re.search(r"Body:\s*([\s\S]+)", raw, re.IGNORECASE)
    return Template(
        subj.group(1).strip() if subj else "",
        body.group(1).strip() if body else "",
    )


def parse_template_blocks(
    cold_email: str, fallback_subject: str = "", fallback_body: str = ""
) -> Templates:
    """Parse the campaign config `templates.coldEmail` string into the 4 blocks.
    If it carries no [BLOCK] markers, the whole text becomes the COLD/FOLLOWUP/FINALPUSH
    body (COLD-AGG empty) — same fallback as the n8n workflow."""
    text = (cold_email or "").strip()
    parsed = {tag: _extract_block(text, tag) for tag in BLOCKS}
    if any(not parsed[t].is_empty for t in BLOCKS):
        return parsed
    base = Template(fallback_subject, text or fallback_body)
    return {
        "COLD": base,
        "COLD-AGG": Template("", ""),
        "FOLLOWUP": base,
        "FINALPUSH": base,
    }


def detect_bad_news(news_text: str) -> bool:
    text = news_text or ""
    return bool(
        re.search(r"isBadNews:\s*true", text, re.IGNORECASE)
        or re.search(r"\[BAD NEWS", text, re.IGNORECASE)
    )

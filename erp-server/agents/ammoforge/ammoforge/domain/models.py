"""Domain models for AMMO FORGE, aligned to n8n workflow rDLhY3sqi6U9xK6t
(EVERTRUST - AMMO FORGE (PG) v2).

AmmoForge is a single-campaign template generator: given a campaignId it fetches the ERP
campaign config, researches demand drivers, forges the cold-outreach template (one tagged
[COLD]/[FOLLOWUP]/[FINALPUSH] sequence) + a newsBrief, and writes them back to the ERP.
Reach (bazooka) later parses coldEmail into the three blocks.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class CampaignConfig:
    """Subset of GET /campaigns/:id/config that AmmoForge needs."""

    campaign_id: str
    name: str = ""
    niche: str = ""
    country: str = ""
    region: str = ""
    project: str = ""
    # admin overrides under automation.templates (tone/language/signature/baseline copy)
    overrides: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ForgeResult:
    """The two string keys AmmoForge writes to /campaigns/:id/templates."""

    cold_email: str
    news_brief: str

    def as_templates(self) -> dict:
        return {"coldEmail": self.cold_email, "newsBrief": self.news_brief}


def _strip_fences(s: str) -> str:
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", str(s).strip())


def parse_forge_json(text: str) -> ForgeResult:
    """Robustly extract {coldEmail, newsBrief} from the model output — port of the n8n
    "Parse Templates (fail loud)" node. Raises ValueError if it can't get both non-empty."""
    cleaned = _strip_fences(text)
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
        raise ValueError(f"Forge: could not parse JSON from model output. Snippet: {cleaned[:200]}")

    missing = [k for k in ("coldEmail", "newsBrief") if not str(data.get(k) or "").strip()]
    if missing:
        raise ValueError(
            f"Forge: missing or empty template block(s): {', '.join(missing)}. "
            f"Got keys: {', '.join(data.keys())}"
        )
    return ForgeResult(cold_email=str(data["coldEmail"]), news_brief=str(data["newsBrief"]))

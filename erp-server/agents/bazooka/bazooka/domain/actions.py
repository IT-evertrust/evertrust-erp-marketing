"""The decision matrix — ERP edition. Pure, fully unit-testable.

The ERP's GET /prospects?sendList=true ALREADY applies the eligibility governance
(active campaign, status in NEW/EMAILED/REPLIED/RE_ENGAGED, 3-day cooldown, followup
cap, suppression). So reach only has to:
  invalid email                 -> skip (INVALID_EMAIL)
  no usable template            -> skip (NO_TEMPLATE)
  followup_count == 0           -> cold       (first touch)
  followup_count == 1           -> followup
  followup_count >= 2           -> finalpush
and pick the matching template block from the campaign config.
"""
from __future__ import annotations

from .hygiene import clean_email, is_valid_email
from .models import Action, Prospect

# preferred campaign.templates keys per action, first match wins (ERP/Ammo-Forge naming
# varies; fall back to the cold body so a campaign with only one template still sends).
TEMPLATE_KEYS = {
    "cold": ["coldEmail", "cold", "COLD"],
    "followup": ["followUp", "followup", "FOLLOWUP", "coldEmail", "cold"],
    "finalpush": ["finalPush", "finalpush", "FINALPUSH", "followUp", "coldEmail", "cold"],
}

# ERP status set after any send (the ERP projects the conversation; EMAILED is the
# canonical "we reached out" state for cold + followups).
STATUS_AFTER_SEND = "EMAILED"


def _pick_template_key(templates: dict, action_type: str) -> str | None:
    for key in TEMPLATE_KEYS[action_type]:
        if templates.get(key):
            return key
    return None


def compute_action(prospect: Prospect, templates: dict) -> Action:
    email = clean_email(prospect.email)
    if not is_valid_email(email):
        return Action("skip", skip_reason="INVALID_EMAIL")

    fc = prospect.followup_count or 0
    if fc <= 0:
        action_type = "cold"
    elif fc == 1:
        action_type = "followup"
    else:
        action_type = "finalpush"

    key = _pick_template_key(templates or {}, action_type)
    if not key:
        return Action("skip", skip_reason="NO_TEMPLATE")
    return Action(action_type, template_key=key)

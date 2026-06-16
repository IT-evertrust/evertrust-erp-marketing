"""Decision matrix — verbatim port of the n8n "Code — Compute Action" node in
zyCTVLpZj3YyR2qV (REACH BAZOOKA (PG) v2). Pure, fully unit-testable.

    invalid email                         -> skip (INVALID_EMAIL)
    status EMAILED  or followup_count>=2  -> finalpush  (FINALPUSH)
    status CONTACTED or followup_count==1 -> followup   (FOLLOWUP)
    otherwise                             -> cold        (COLD-AGG if bad news + a
                                                          non-empty COLD-AGG block exists,
                                                          else COLD)
The ERP's GET /prospects?sendList=true already gates eligibility/cooldown/cap/suppression.
"""
from __future__ import annotations

from .hygiene import clean_email, is_valid_email
from .models import Action, News, Prospect, Templates

STATUS_AFTER_SEND = "EMAILED"


def compute_action(prospect: Prospect, templates: Templates, news: News) -> Action:
    email = clean_email(prospect.email)
    if not is_valid_email(email):
        return Action("skip", skip_reason="INVALID_EMAIL")

    agg = templates.get("COLD-AGG")
    agg_available = bool(agg and not agg.is_empty)
    status = (prospect.status or "").strip().upper()
    fu = prospect.followup_count or 0

    if status == "EMAILED" or fu >= 2:
        return Action("finalpush", template_block="FINALPUSH")
    if status == "CONTACTED" or fu == 1:
        return Action("followup", template_block="FOLLOWUP")
    block = "COLD-AGG" if (news.is_bad_news and agg_available) else "COLD"
    return Action("cold", template_block=block)

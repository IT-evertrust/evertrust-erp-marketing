"""Template forge masters + per-niche focus maps — port of 'Explode Blocks'.

The n8n node holds hand-crafted English master subjects/bodies for COLD/FOLLOWUP/FINALPUSH.
NOTE: the blueprint captured the forge MECHANISM and the per-niche focus maps, but not the
literal master copy verbatim. The masters below are faithful-in-structure placeholders
(same placeholders, same signature, same flow); replace MASTERS with the exact n8n strings
when porting for production. The {{Company Name}} placeholder is intentionally LEFT for
Bazooka to fill per-lead.
"""
from __future__ import annotations

BLOCKS = ["COLD", "FOLLOWUP", "FINALPUSH"]

# {{IndustryFocus}} / {{TenderFocus}} per niche (verbatim niche keys from the n8n node)
NICHE_FOCUS = {
    "LED": ("LED lighting and display systems", "municipal and KRITIS lighting tenders"),
    "PV/BESS/TRAFO": ("solar, battery storage and transformer infrastructure", "energy-transition tenders"),
    "CONTAINER": ("modular and container construction", "public modular-building tenders"),
    "CLEANING SERVICE": ("facility and building cleaning", "public facility-management tenders"),
    "CHARGING PORT": ("EV charging infrastructure", "public e-mobility tenders"),
    "DGUV V3 INSPECTION": ("electrical safety inspection", "public compliance-inspection tenders"),
    "WÄRMEPUMPE": ("heat-pump installation", "public heating-modernization tenders"),
    "CYBERSECURITY": ("cybersecurity services", "federal and KRITIS security tenders"),
}
DEFAULT_FOCUS = ("your sector", "German public tenders")

# faithful-in-structure master templates (see module docstring) — replace with exact n8n copy
MASTERS = {
    "COLD": {
        "subject": "{{Company Name}} — access to {{TenderFocus}}",
        "body": ("Dear {{Company Name}} team,\n\n"
                 "We help {{IndustryFocus}} companies win {{TenderFocus}} in Germany. "
                 "Your work in {{Type}} is a strong fit.\n\n"
                 "Would a short call make sense?\n\n"
                 "Kind regards,\nHanna Nguyen\nEVERTRUST GmbH"),
    },
    "FOLLOWUP": {
        "subject": "Following up — {{Company Name}}",
        "body": ("Dear {{Company Name}} team,\n\n"
                 "Just following up on {{TenderFocus}} for {{IndustryFocus}} firms. "
                 "Happy to share how we qualify partners.\n\n"
                 "Kind regards,\nHanna Nguyen\nEVERTRUST GmbH"),
    },
    "FINALPUSH": {
        "subject": "Last note — {{Company Name}}",
        "body": ("Dear {{Company Name}} team,\n\n"
                 "Closing the loop on {{TenderFocus}}. If it is not relevant now, no reply "
                 "needed and we will not write again.\n\n"
                 "Kind regards,\nHanna Nguyen\nEVERTRUST GmbH"),
    },
}


def explode_blocks(niche: str) -> list[dict]:
    """Resolve the per-niche focus into each block's master subject/body."""
    industry, tender = NICHE_FOCUS.get((niche or "").upper(), DEFAULT_FOCUS)
    out = []
    for block in BLOCKS:
        m = MASTERS[block]
        fill = lambda s: (s.replace("{{Type}}", niche or "your sector")
                          .replace("{{IndustryFocus}}", industry)
                          .replace("{{TenderFocus}}", tender))
        out.append({"block": block, "subject": fill(m["subject"]), "body": fill(m["body"])})
    return out

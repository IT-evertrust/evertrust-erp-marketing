"""LLM calls for AmmoForge — two steps, prompts kept verbatim with n8n workflow
rDLhY3sqi6U9xK6t:
  1. research_demand_drivers() — market-intelligence research (prose). The n8n node uses
     OpenAI web-search as a built-in tool; via the LiteLLM gateway that tool may be absent,
     so this is a plain completion (the model uses its own knowledge). Wire a search-capable
     model/gateway to restore live web research.
  2. forge_templates() — senior copywriter producing the 3-block coldEmail + newsBrief as
     strict JSON.

offline_forge() / offline_research() are the --no-llm / test paths (deterministic, no gateway).
"""
from __future__ import annotations

from ..domain.models import CampaignConfig, ForgeResult, parse_forge_json

RESEARCH_SYSTEM = (
    "You are a market-intelligence researcher for Evertrust GmbH, a German company that "
    "recruits EU suppliers into GERMAN public tenders. Use web search to find RECENT, real, "
    "citable demand drivers — especially BAD NEWS (conflicts, geopolitical tensions, breaches, "
    "cyberattacks, disasters, accidents, failures, sabotage, regulatory crackdowns, shortages, "
    "crises) ANYWHERE in the world — that create PRESSURE or URGENCY increasing GERMAN "
    "public-sector demand or procurement (federal, state, KRITIS) for a given niche. The causal "
    "chain MUST end in Germany: bad event (anywhere) -> pressure on German buyers -> more German "
    "tender demand for the niche. Do NOT return tender listings or positive PR. Respond with "
    "prose only — no JSON, no code fences."
)

FORGE_SYSTEM = (
    "You are a senior B2B outbound copywriter for Evertrust GmbH, a German company that recruits "
    "EU suppliers into GERMAN public tenders. You write the cold-outreach email template for a "
    "campaign as a single tagged ESCALATING SEQUENCE of three blocks.\n\n"
    "Keep {{Company Name}} and any other {{placeholder}} EXACTLY as written (title case, with the "
    "literal double braces) — they are filled per-lead later by another system. The sign-off is "
    'always "Hanna Nguyen", then "EVERTRUST GmbH", then "We are at your disposal.", each on its '
    "own line.\n\n"
    "Write in professional English: formal, direct, credible. No hype, no exclamation marks, no "
    "emojis, no markdown.\n\n"
    "You MUST reproduce the three-block template EXACTLY — keep the literal [COLD], [FOLLOWUP] and "
    "[FINALPUSH] tags and the Subject:/Body: labels on their own lines, keep every {{Company Name}} "
    "placeholder verbatim, and keep the sign-off verbatim. Replace <Niche> (title case) and <niche> "
    "(lower case) everywhere with the real campaign niche, replace <current/next month> with the "
    "appropriate month, and replace the <1-2 sentences ...> line in the [COLD] block with one or two "
    "natural sentences weaving in the strongest demand-driver pressure for German public-sector "
    "demand. Do not add, drop, reorder, or re-label any block.\n\n"
    "TEMPLATE:\n"
    "[COLD]\nSubject: <Niche> - Qualification for German Public Sector in <current/next month>\n"
    "Body:\nDear {{Company Name}},\n\n<1-2 sentences weaving in the demand-driver pressure that is "
    "raising German public-sector demand for the niche>\n\nWe are therefore reviewing selected "
    "partners in the field of <niche> for upcoming German public tenders, particularly for <niche> "
    "systems and related public procurement projects.\n\n{{Company Name}} remains relevant to us, as "
    "your <niche> solutions may be a good fit for this demand.\n\nHowever, we are only continuing "
    "discussions with companies that are technically suitable and able to enter the qualification "
    "process at short notice.\n\nPlease confirm your availability for a brief 20-minute video "
    "qualification call this week, so we can assess whether {{Company Name}} can still be included in "
    "the current selection.\n\nKind regards,\nHanna Nguyen\nEVERTRUST GmbH\nWe are at your disposal.\n\n"
    "[FOLLOWUP]\nSubject: Following Up - <Niche> Qualification For German Tenders\nBody:\nDear "
    "{{Company Name}},\n\nWe reached out 2 days ago regarding upcoming German public tenders related "
    "to <niche>.\n\nAs we are currently reviewing selected partners in the field of <niche>, we wanted "
    "to follow up in case our previous message was missed. We are still assessing companies for "
    "upcoming tenders, particularly involving <niche> systems and related public procurement "
    "projects.\n\nIf {{Company Name}} is interested in being considered for the current qualification "
    "round, please let us know your availability for a short 20-minute call this week.\n\nKind regards,"
    "\nHanna Nguyen\nEVERTRUST GmbH\nWe are at your disposal.\n\n"
    "[FINALPUSH]\nSubject: Urgent - Finalising <Niche> Partner Selection\nBody:\nDear {{Company Name}},"
    "\n\nWe contacted {{Company Name}} 4 days ago regarding upcoming German public tenders related to "
    "<niche>.\n\nWe are now finalising our current shortlist of <niche> partners for projects involving "
    "<niche> systems and related public procurement projects.\n\nAs the qualification phase is moving "
    "forward shortly, we require a response within the next 24 hours if {{Company Name}} would still "
    "like to be considered for the current selection process.\n\nIf we do not hear back, we will "
    "proceed with other shortlisted companies.\n\nKind regards,\nHanna Nguyen\nEVERTRUST GmbH\nWe are "
    "at your disposal.\n\n"
    "ADMIN DEFAULTS (campaign-level overrides): when an ADMIN OVERRIDES value is present (not "
    '"(none)") it OVERRIDES the matching default; baseline copy is adapted not invented; admin '
    "signature replaces the sign-off; admin tone steers wording; admin language (en/de) sets the "
    "language of all prose/subjects/bodies but NEVER the tags or labels or {{placeholders}}. The "
    "output contract is unchanged: strict JSON with coldEmail (three tagged blocks) + newsBrief."
)


def _ov(overrides: dict, *path) -> str:
    cur = overrides or {}
    for key in path:
        if not isinstance(cur, dict):
            return "(none)"
        cur = cur.get(key)
    return str(cur) if cur not in (None, "") else "(none)"


def _forge_user(cfg: CampaignConfig, research: str) -> str:
    o = cfg.overrides
    return (
        "Output STRICT JSON with EXACTLY two string keys and nothing else: coldEmail and newsBrief.\n\n"
        "Campaign context:\n"
        f"- Niche: {cfg.niche}\n- Country: {cfg.country}\n- Region: {cfg.region}\n"
        f"- Project: {cfg.project}\n\n"
        "Demand-driver research (weave the strongest pressure into the [COLD] opening; do not quote "
        f"verbatim):\n{research}\n\n"
        "Field requirements:\n"
        "- coldEmail: the FULL three-block tagged sequence from the system template, reproduced "
        "EXACTLY, with <Niche>/<niche> replaced by the real niche, <current/next month> resolved, and "
        "the <1-2 sentences ...> placeholder in [COLD] replaced by one or two natural demand-driver "
        "sentences. Keep the [COLD]/[FOLLOWUP]/[FINALPUSH] tags, Subject:/Body: labels, every "
        "{{Company Name}} placeholder, and the sign-off verbatim.\n"
        "- newsBrief: a 200-400 word demand-driver brief (prose) for internal context.\n\n"
        'Escape newlines as \\n inside the JSON strings. Return ONLY: {"coldEmail":"...","newsBrief":"..."}\n\n'
        "ADMIN OVERRIDES (\"(none)\" = not set):\n"
        f"- Tone: {_ov(o, 'tone')}\n- Language: {_ov(o, 'language')}\n"
        f"- Signature (verbatim sign-off when set):\n{_ov(o, 'signature')}\n"
        f"- Baseline COLD subject: {_ov(o, 'default', 'cold', 'subject')}\n"
        f"- Baseline COLD body:\n{_ov(o, 'default', 'cold', 'body')}\n"
        f"- Baseline FOLLOWUP subject: {_ov(o, 'default', 'followup', 'subject')}\n"
        f"- Baseline FOLLOWUP body:\n{_ov(o, 'default', 'followup', 'body')}\n"
        f"- Baseline FINALPUSH subject: {_ov(o, 'default', 'finalPush', 'subject')}\n"
        f"- Baseline FINALPUSH body:\n{_ov(o, 'default', 'finalPush', 'body')}"
    )


def _client(settings):
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the LiteLLM gateway.")
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def research_demand_drivers(settings, cfg: CampaignConfig) -> str:
    client = _client(settings)
    user = (
        "Find recent demand drivers (last ~90 days) — conflicts, tensions, breaches, attacks, "
        "disasters, failures, regulation, or crises — that pressure GERMAN public-sector buyers "
        "(federal, state, KRITIS) to procure or accelerate spending in this niche.\n\n"
        f"Niche: {cfg.niche}\nSupplier country (context only): {cfg.country}\n"
        f"Region context: {cfg.region}\nTender / demand market: Germany (federal, state, KRITIS)\n\n"
        "Explain the causal chain explicitly, ending in Germany. Cite sources with URLs where "
        "possible. Summarise the strongest 3-5 drivers in clear prose."
    )
    resp = client.chat.completions.create(
        model=settings.research_model,
        temperature=0.4,
        messages=[{"role": "system", "content": RESEARCH_SYSTEM}, {"role": "user", "content": user}],
    )
    return resp.choices[0].message.content or ""


def forge_templates(settings, cfg: CampaignConfig, research: str) -> ForgeResult:
    client = _client(settings)
    resp = client.chat.completions.create(
        model=settings.forge_model,
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": FORGE_SYSTEM},
            {"role": "user", "content": _forge_user(cfg, research)},
        ],
    )
    return parse_forge_json(resp.choices[0].message.content or "")


# ---- offline (no gateway) paths for tests / isolated runs ------------------

def offline_research(cfg: CampaignConfig) -> str:
    return (
        f"[offline] Demand drivers for {cfg.niche}: recent supply-chain and security pressures are "
        f"raising German public-sector ({cfg.country or 'EU'}) procurement urgency for {cfg.niche}."
    )


def offline_forge(cfg: CampaignConfig, research: str) -> ForgeResult:
    niche = cfg.niche or "the niche"
    cold = (
        "[COLD]\n"
        f"Subject: {niche} - Qualification for German Public Sector\n"
        "Body:\nDear {{Company Name}},\n\n"
        f"{research}\n\n"
        f"We are reviewing selected partners in the field of {niche} for upcoming German public "
        "tenders.\n\nKind regards,\nHanna Nguyen\nEVERTRUST GmbH\nWe are at your disposal.\n\n"
        "[FOLLOWUP]\n"
        f"Subject: Following Up - {niche} Qualification For German Tenders\n"
        "Body:\nDear {{Company Name}},\n\nWe reached out 2 days ago regarding upcoming German public "
        f"tenders related to {niche}.\n\nKind regards,\nHanna Nguyen\nEVERTRUST GmbH\nWe are at your "
        "disposal.\n\n"
        "[FINALPUSH]\n"
        f"Subject: Urgent - Finalising {niche} Partner Selection\n"
        "Body:\nDear {{Company Name}},\n\nWe contacted {{Company Name}} 4 days ago regarding upcoming "
        f"German public tenders related to {niche}.\n\nKind regards,\nHanna Nguyen\nEVERTRUST GmbH\n"
        "We are at your disposal."
    )
    return ForgeResult(cold_email=cold, news_brief=research)

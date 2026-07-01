"""Prompt Forge workflow — turn a Reach AIM config into an OpenAI lead-scraping prompt.

Reach's MANUAL scraping path repurposes the local model (hermes/qwen via the LiteLLM
gateway) as a *prompt author*. Rather than let the model invent the whole prompt from
scratch (which produced inconsistent results — sometimes far fewer than 25 leads), this
workflow starts from a STORED TEMPLATE (``SCRAPE_PROMPT_TEMPLATE``) that hard-codes the
non-negotiables — a minimum of 25 leads per batch with per-state coverage (aim N per state),
exhausting public sources, the AAA/A/B revenue tiers + USD 5M floor, the contact policy (keep
only companies with at least one verified email or phone, prefer a senior Sales contact), the
per-lead `state` tag, the strict no-hallucination rules, and the exact JSON schema. The
template has ``{{placeholders}}`` that are filled from the AIM config (reach.aims fields),
then the filled template is sent to the local model for REFINEMENT (sharpen the niche /
search-strategy wording only). The refined prompt is validated to confirm it still carries
every hard requirement; if the model is unavailable or drops one, we fall back to the
filled template — which is itself a complete, valid prompt. So we never return a weak one.

The ONLY output here is that prompt string — no web search, no scraping, no DB writes.

/run input contract:
  config (dict, required) — the wire AIM config (same shape ammo_forge/lead_satellite get,
    plus the AIM targeting fields):
      { campaignId, name, project, region, country, segment, source,
        targetType, industryFocus, tenderFocus,
        niche: { name, slug, industry, targets: [ {name, searchHint}, ... ] } }
  llm: {baseUrl, model, apiKey} — optional per-request override (request value ?? env).

output.prompt — the final lead-scraping prompt (string).
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow

# The central agents .env lives at erp-agents/.env. From this file
# (erp-agents/src/erp_agents/workflows/reach/prompt_forge/workflow.py) that is parents[5];
# we also probe a couple of nearby roots so the loader is robust to layout differences.
_HERE = Path(__file__).resolve()
_ENV_CANDIDATES = tuple(
    _HERE.parents[i] / ".env" for i in (5, 4, 6, 3) if i < len(_HERE.parents)
)


def _load_dotenv() -> None:
    """Best-effort load of the central agents .env (process env wins via setdefault).
    Loads every candidate that exists (setdefault means the first value found wins)."""
    for env_file in _ENV_CANDIDATES:
        try:
            if not env_file.exists():
                continue
            for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
        except OSError:
            continue


def _clean(v: Any) -> str:
    return str(v).strip() if v is not None else ""


def _targets_line(niche: dict) -> str:
    targets = [t for t in (niche.get("targets") or []) if isinstance(t, dict)]
    names: list[str] = []
    for t in targets:
        name = _clean(t.get("name"))
        hint = _clean(t.get("searchHint"))
        if not name:
            continue
        names.append(f"{name} ({hint})" if hint else name)
    return ", ".join(names)


# German federal states (Bundesländer). Drives per-state coverage when the campaign
# country is Germany; other countries fall back to a generic "every state/region" line.
_GERMAN_STATES = [
    "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
    "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
    "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
    "Schleswig-Holstein", "Thüringen",
]


def _states_for_country(country: str) -> str:
    c = country.strip().lower()
    if c in ("germany", "deutschland", "de", "ger", "deu"):
        return ", ".join(_GERMAN_STATES)
    return f"every state / region / province of {country or 'the country'}"


def _keywords_block(niche: dict, niche_name: str, country: str) -> str:
    """Render the seed search queries from the niche targets (reused as keywords — no new
    field). Falls back to a few queries derived from the niche + country when none are set."""
    lines: list[str] = []
    for t in niche.get("targets") or []:
        if not isinstance(t, dict):
            continue
        q = _clean(t.get("searchHint")) or _clean(t.get("name"))
        if q:
            lines.append(f"- {q}")
    if not lines:
        base = niche_name or "the target"
        loc = country or ""
        lines = [
            f"- {base} Firma {loc}".strip(),
            f"- {base} Unternehmen {loc}".strip(),
            f"- {base} GmbH {loc}".strip(),
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# The stored lead-scraping prompt TEMPLATE. {{placeholders}} are filled from the AIM
# config; everything else is fixed so every batch carries the same hard requirements.
# NOTE: this contains literal JSON braces, so it is filled with str.replace (NOT .format).
# ---------------------------------------------------------------------------
SCRAPE_PROMPT_TEMPLATE = """\
You are a B2B lead researcher with live web browsing. Find REAL, currently-operating companies for this campaign and return them as strict JSON.

CAMPAIGN
- Niche: {{niche}}
- Industry focus: {{industry_focus}}
- Tender focus: {{tender_focus}}
- Target type: {{target_type}}
- Country: {{country}}
- Region / zone: {{region}}
- Segment: {{segment}}

SEED SEARCH QUERIES — start here, then expand
{{keywords}}
Run each query above, then broaden with synonyms, adjacent sub-niches, trade terms and more cities. Localise queries to the country's language (e.g. German) where that surfaces more local companies. These are starting points, not limits — keep going until the volume target below is met.

GEOGRAPHIC COVERAGE — WORK STATE BY STATE (this drives both quality and de-duplication)
- {{country}} is divided into these states/regions: {{states}}.
- Go through them ONE AT A TIME. Aim for at least {{leads_per_state}} qualified companies in EACH state before moving to the next.
- Tag every company with the state it is headquartered / primarily operating in via the `state` field, using the exact state name from the list above.
- Spread coverage — do NOT return everything from one big state and nothing from the smaller ones.

FINDING THE CONTACT — DO THIS FOR EVERY COMPANY (this is the whole point)
Open the company's own site and actively hunt for a public email AND phone in ALL of these places:
- The "Impressum" / legal-notice page. German companies are LEGALLY REQUIRED to publish a contact email and phone here, so ALWAYS open the Impressum — it is your single best source.
- The "Kontakt" / "Contact" page, the page footer, and the "Über uns" / "About" / team page.
Prefer a NAMED SENIOR contact in Sales where one is publicly listed — Head of Sales, Vertriebsleiter, Sales Director, Geschäftsführer / Managing Director, Business Development — and put their role in `contact_title`. If no named person is public, use the company's public role address (info@, vertrieb@, sales@, kontakt@).
Emails are written in many forms — recognise and NORMALISE every one to a plain address:
- Plain text: info@company.de
- mailto links: href="mailto:info@company.de"
- Anti-scraper obfuscation: "info [at] company [dot] de", "info(at)company.de", "info AT company DOT de", "info @ company . de", or with unicode/zero-width spaces — reconstruct these to info@company.de.
- HTML-entity encoded (e.g. &#105;nfo@…) or JavaScript-assembled addresses — decode/assemble them.
Phone: read it from the same Impressum/Kontakt/footer; accept German formats (+49 …, 0…, with spaces, /, - or ()) and keep it as printed.

CONTACT POLICY — at least ONE verified channel per company
- Only keep a company for which you found AT LEAST ONE real, public channel: an email OR a phone (BOTH preferred). Aggressively try to get both.
- If a company has NEITHER a findable public email NOR a public phone, DROP it — do not pad the list with contactless rows, and NEVER invent an email or phone.

VOLUME — HARD REQUIREMENT
- Return a MINIMUM of 25 companies overall, working toward {{leads_per_state}} per state across the states listed above. Do NOT stop early, do NOT trim, do NOT summarise.
- If you are short, broaden your queries (synonyms, adjacent sub-niches, more cities/states) and KEEP SEARCHING until the target is met.
- EXHAUST every publicly available source before finishing: company websites, business directories, public/company registries, industry associations, trade-fair and membership lists, chambers of commerce, public tender portals, news, job boards, and public professional-network pages.

REVENUE TIERS — only companies with at least USD 5,000,000 annual revenue
Classify each company into `revenue_tier`:
- AAA = USD 20M per year or above
- A   = USD 10-20M per year
- B   = USD 5-10M per year
Exclude any company under USD 5M. Judge revenue from public signals (filings, press, funding/company profiles, headcount, industry estimates); when revenue falls between bands, pick the closest tier.

NO HALLUCINATION — CRITICAL
- Only return companies you ACTUALLY found on real, live web pages via search. Do NOT invent or guess companies.
- Do NOT fabricate emails, phone numbers, websites, locations, state, revenue, or sources. If you did not open the page and see the value, it is null.
- Every company must be a real, verifiable organisation; if you cannot verify it exists, do not include it.
- Never cite or rely on a source you did not actually open. No placeholder or example data.
- PROVENANCE: every lead MUST include `source_url` — the exact page URL you actually opened to get this company and its details (e.g. the Impressum URL where you read the email). If you cannot give a real source_url you opened, DO NOT include the company. A lead with no source_url is not acceptable.

OUTPUT — STRICT JSON ONLY (no prose, no explanation, no markdown, no code fences), exactly this shape:
{"leads": [{"company": "string", "contact_name": "string|null", "contact_title": "string|null", "email": "string|null", "phone": "string|null", "website": "string|null", "location": "string|null", "state": "string|null", "revenue_tier": "AAA|A|B", "source_url": "string", "qualification_reason": "string|null", "confidence": 0.0, "status": "NEW"}]}
Rules: `company` and `source_url` are REQUIRED (source_url is the real page you opened); `revenue_tier` is exactly one of AAA/A/B; `state` is the state/region from the coverage list the company operates in; AT LEAST ONE of `email`/`phone` must be non-null for every company (a row with neither is dropped, never fabricated); `contact_title` is the senior contact's role when a named person was found; `contact_name`, `website`, `location` are null when not confidently found (never fabricated) — but you must genuinely have looked in the Impressum/Kontakt/footer first; `confidence` is 0.0-1.0 for niche fit; `status` is always "NEW". The JSON must be valid and directly parseable."""


# System instruction for the REFINEMENT call: polish only, preserve every hard rule.
REFINE_SYSTEM = (
    "You are a prompt engineer improving a B2B lead-scraping prompt that will be pasted into "
    "ChatGPT (with live web browsing). You are given a complete, working prompt. Refine ONLY the "
    "CAMPAIGN framing and the search-strategy wording so it is sharper and more specific to this "
    "niche, region and target type (e.g. concrete example queries, the right sub-segments and "
    "cities). You MUST keep the following UNCHANGED in meaning and strength: the requirement to "
    "return a MINIMUM of 25 companies with per-state coverage (aim for the stated number in each "
    "state); the instruction to exhaust every public source; the AAA/A/B revenue tiers and the USD "
    "5M floor; the contact policy (keep only companies with at least one verified public email or "
    "phone, prefer a named senior Sales contact, never fabricate a channel); the per-company `state` "
    "tagging; the NO-HALLUCINATION / do-not-fabricate rules; and the exact JSON output schema (same "
    "keys incl. state and contact_title, same shape). Do not weaken, drop, or reword away any of "
    "those. Return ONLY the final prompt text — no preamble, no explanation, no code fences."
)


def _fill_template(config: dict) -> str:
    """Fill SCRAPE_PROMPT_TEMPLATE's {{placeholders}} from the AIM config (reach.aims)."""
    niche = config.get("niche") if isinstance(config.get("niche"), dict) else {}
    niche_name = _clean(niche.get("name")) or _clean(config.get("nicheName")) or "the target niche"
    industry = niche.get("industry")
    industry = industry.get("name") if isinstance(industry, dict) else _clean(industry)
    country_val = _clean(config.get("country")) or "Germany"
    lps = config.get("leadsPerState")
    leads_per_state = str(int(lps)) if isinstance(lps, (int, float)) and lps > 0 else "10"
    values = {
        "campaign": _clean(config.get("name")) or "(unnamed campaign)",
        "niche": niche_name,
        "industry_focus": _clean(config.get("industryFocus")) or industry or niche_name,
        "tender_focus": _clean(config.get("tenderFocus")) or niche_name,
        "target_type": _clean(config.get("targetType")) or "companies",
        "region": _clean(config.get("region")) or "Anywhere",
        "country": country_val,
        "segment": _clean(config.get("segment")) or "(no specific segment)",
        "keywords": _keywords_block(niche, niche_name, country_val),
        "states": _states_for_country(country_val),
        "leads_per_state": leads_per_state,
    }
    out = SCRAPE_PROMPT_TEMPLATE
    for key, val in values.items():
        out = out.replace("{{" + key + "}}", val)
    return out


def _preserves_hard_requirements(text: str) -> bool:
    """True only if a refined prompt still carries every non-negotiable: the JSON schema,
    the revenue tier field, the 25-lead minimum, and an anti-fabrication rule."""
    if not text:
        return False
    low = text.lower()
    has_schema = (
        '"leads"' in text
        and "revenue_tier" in text
        and "source_url" in text
        and '"state"' in text
    )
    has_minimum = "25" in text
    has_tiers = "AAA" in text
    has_anti_hallucination = any(
        marker in low
        for marker in ("hallucinat", "do not invent", "never fabricate", "do not fabricate", "never invent")
    )
    return has_schema and has_minimum and has_tiers and has_anti_hallucination


class PromptForgeWorkflow(Workflow):
    name = "reach.prompt_forge"

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        inp = job.input or {}
        config = inp.get("config")
        if not isinstance(config, dict) or not config:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=["config is required (the AIM config to scope the prompt)"],
            )

        # 1) Fill the stored template from the AIM config — a complete, valid prompt on its own.
        filled = _fill_template(config)

        _load_dotenv()
        llm = inp.get("llm") if isinstance(inp.get("llm"), dict) else {}
        base_url = _clean(llm.get("baseUrl")) or os.environ.get("LLM_BASE_URL", "").strip()
        api_key = _clean(llm.get("apiKey")) or os.environ.get("LLM_API_KEY", "").strip() or "sk-anything"

        candidates: list[str] = []
        for m in (
            _clean(llm.get("model")),
            os.environ.get("DRAFT_MODEL", "").strip(),
            os.environ.get("LLM_MODEL", "").strip(),
            "hermes",
        ):
            if m and m not in candidates:
                candidates.append(m)

        trace.append(
            AgentTraceStep(
                name="fill_template",
                input={"llm_base_url": bool(base_url), "candidates": candidates},
                output={"filled_chars": len(filled)},
            )
        )

        # 2) Refine the filled template with the local model (polish only). Fall back to the
        # filled template if the gateway is unavailable or a refinement drops a hard rule.
        prompt = ""
        used_model = ""
        errors: list[str] = []
        if base_url:
            from openai import OpenAI

            client = OpenAI(base_url=base_url, api_key=api_key, timeout=90.0, max_retries=0)
            for candidate in candidates:
                try:
                    resp = client.chat.completions.create(
                        model=candidate,
                        messages=[
                            {"role": "system", "content": REFINE_SYSTEM},
                            {"role": "user", "content": filled},
                        ],
                        temperature=0.3,
                    )
                    refined = (resp.choices[0].message.content or "").strip()
                    if refined and _preserves_hard_requirements(refined):
                        prompt = refined
                        used_model = candidate
                        break
                    if refined:
                        errors.append(f"{candidate}: refinement dropped a hard requirement — ignored")
                    else:
                        errors.append(f"{candidate}: empty response")
                except Exception as exc:  # noqa: BLE001 — try next model, surface failures
                    errors.append(f"{candidate}: {exc}")
        else:
            errors.append("LLM_BASE_URL not set — used the template without refinement")

        # 3) Fallback: the filled template is itself a complete, requirement-complete prompt.
        if not prompt:
            prompt = filled
            used_model = "template"

        trace.append(
            AgentTraceStep(
                name="refine",
                output={"used_model": used_model, "refine_notes": errors[:4]},
            )
        )
        return AgentResult(
            job_id=job.job_id,
            workflow=self.name,
            status="success",
            output={
                "campaign_id": _clean(config.get("campaignId") or config.get("id")),
                "prompt": prompt,
                "generated_by": used_model,
            },
            metrics={"prompt_chars": len(prompt), "model": used_model, "refined": used_model != "template"},
            trace=trace,
        )

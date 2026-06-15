"""LLM calls — demand-driver news research (hermes) + template polish/translate (deepseek).
Prompts VERBATIM from the n8n nodes. Offline stubs return no-news / unpolished masters."""
from __future__ import annotations

import json

NEWS_SYSTEM = """You are a market-intelligence researcher for Evertrust GmbH (a German company that recruits EU suppliers into GERMAN public tenders). Use web search to find RECENT, real, citable BAD NEWS — conflicts, geopolitical tensions, breaches, cyberattacks, disasters, accidents, failures, sabotage, regulatory crackdowns, shortages, or crises, ANYWHERE in the world — that create PRESSURE or URGENCY which increases GERMAN public-sector demand or procurement (federal, state, KRITIS) for a given niche. The event may occur in any country; what matters is that it drives GERMAN demand. Make the causal chain explicit and END it in Germany: bad event → pressure on German buyers → more German tender demand for the niche. Do NOT return tender listings or positive PR. Label each item's sentiment and severity. Return raw JSON only — no prose, no code fences."""

NEWS_USER_TEMPLATE = """OUTPUT LANGUAGE: Write EVERY output value — each item's headline, summary and whyItMatters, and every entry in "hooks" — in {lang}. German ONLY when the supplier country is Germany; otherwise English. Keep the JSON keys in English and translate only the values. Do NOT emit raw "A -> B -> C" arrow chains in the hooks — write each hook as one natural sentence in {lang}.

Find recent BAD NEWS (last ~90 days) — conflicts, tensions, breaches, attacks, disasters, failures, or crises, ANYWHERE in the world — that increase pressure on GERMAN public-sector buyers (federal, state, KRITIS) to procure or accelerate spending in this niche. We recruit EU suppliers to qualify for GERMAN public tenders, so the demand we care about is GERMAN — the supplier's own country is only context.

Niche: {niche}
Supplier country (context only): {country}
Region context: {city}, {country}
Tender / demand market: Germany (federal, state, KRITIS)

The causal chain MUST END in Germany: [bad event, anywhere] -> [why it pressures GERMAN buyers] -> [more GERMAN tender demand for {niche}].
Avoid positive/PR news and tender listings. Label each item's sentiment ("bad"|"good"|"neutral") and severity (0-1).
Return RAW JSON only: {{"news":[{{"headline":"","summary":"the event","whyItMatters":"why it drives GERMAN demand for {niche}","sentiment":"bad|good|neutral","category":"conflict|breach|cyberattack|disaster|accident|failure|regulation|shortage|tension|other","severity":0.0,"source":"","url":"https://...","date":"YYYY-MM-DD"}}],"hooks":["urgent hook tying the threat to GERMAN procurement"],"confidence":0.0}}
Only real searched items with a URL. Nothing credible -> {{"news":[],"hooks":[],"confidence":0}}."""

FORGE_SYSTEM_EN = """You are an outreach copywriter for Evertrust GmbH, a German company. Below is a hand-crafted outreach template with campaign-specific context already filled in. Your job: polish minor prose issues ONLY. Do NOT rewrite, restructure, change the tone, or remove sentences. KEEP the {{Company Name}} placeholder EXACTLY as written (it will be replaced per-lead later by another workflow). Preserve the exact casing of the niche term wherever it appears (acronyms like LED stay uppercase, common nouns like container stay lowercase). Respond with raw JSON only, no prose, no code fences. JSON shape: { "finalSubject": "...", "finalBody": "...", "confidence": <0.0-1.0>, "reasoning": "one short sentence" }"""

FORGE_SYSTEM_DE = """You are an outreach copywriter for Evertrust GmbH, a German company. Below is a hand-crafted ENGLISH outreach template with campaign-specific context already filled in. Your job: TRANSLATE it into professional German business-email language using the formal Sie-form. Preserve the meaning, structure, and paragraph breaks exactly — do NOT add, remove, reorder, or shorten sentences. KEEP the {{Company Name}} placeholder EXACTLY as written in English (it will be replaced per-lead later by another workflow). Keep product and standard acronyms unchanged (LED, PV, BESS, TRAFO, DGUV V3); the word Wärmepumpe stays German. Translate generic nouns naturally with correct German noun capitalisation. Keep the signature lines Hanna Nguyen and EVERTRUST GmbH unchanged. Respond with raw JSON only, no prose, no code fences. JSON shape: { "finalSubject": "...", "finalBody": "...", "confidence": <0.0-1.0>, "reasoning": "one short sentence" }"""


def _client(settings):
    from openai import OpenAI
    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL not set — use --no-llm or configure the gateway.")
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)


def _brace_slice(text):
    if not isinstance(text, str):
        return None
    t = text.strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        return json.loads(t[a:b + 1])
    except json.JSONDecodeError:
        return None


def research_news(settings, niche: str, city: str, country: str, lang: str) -> dict:
    user = NEWS_USER_TEMPLATE.format(niche=niche, city=city, country=country, lang=lang)
    resp = _client(settings).chat.completions.create(
        model=settings.news_model,
        messages=[{"role": "system", "content": NEWS_SYSTEM}, {"role": "user", "content": user}],
    )
    return _brace_slice(resp.choices[0].message.content) or {"news": [], "hooks": [], "confidence": 0}


def polish_block(settings, lang: str, block: dict, niche: str, city: str, project: str) -> dict:
    system = FORGE_SYSTEM_DE if lang == "German" else FORGE_SYSTEM_EN
    user = (f"Stage: {block['block']}\nTarget language: {lang}\n"
            f"Niche: {niche} | City: {city} | Project: {project}\n\n"
            f"Subject: {block['subject']}\nBody:\n{block['body']}")
    resp = _client(settings).chat.completions.create(
        model=settings.forge_model, temperature=0.2,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    parsed = _brace_slice(resp.choices[0].message.content)
    if parsed and parsed.get("finalBody"):
        return {"block": block["block"], "subject": parsed.get("finalSubject", block["subject"]),
                "body": parsed["finalBody"]}
    return block  # fall back to the master on parse failure


def offline_news(*_args, **_kwargs) -> dict:
    return {"news": [], "hooks": [], "confidence": 0}

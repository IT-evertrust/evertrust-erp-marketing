"""LLM steps for Satellite — lead research + email recovery, prompts kept close to the
n8n workflow. The n8n agent calls a web_search tool in a loop; the Python port grounds the
model with results from the injected SearchGateway, then asks for strict JSON.

offline_* paths produce deterministic output for tests / --no-llm (no gateway, no network).
"""
from __future__ import annotations

import json
import re

from ..domain.models import Lead, Segment, email_status


def _extract_json(text: str):
    if not text:
        return None
    if isinstance(text, dict):
        return text
    t = str(text).strip()
    a, b = t.find("{"), t.rfind("}")
    if a >= 0 and b > a:
        t = t[a : b + 1]
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        return None


def _client(settings):
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    # Hard timeout + no retries: hermes can be slow, and the SDK's 600s × 2-retry default
    # would let a single call hang the whole run for minutes. Fail fast; callers are best-effort.
    return OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key,
                  timeout=45.0, max_retries=0)


def _lead_from(d: dict, seg: Segment) -> Lead:
    em, status = email_status(d.get("email"))
    return Lead(
        name=str(d.get("name") or "").strip(),
        type=str(d.get("type") or "").strip(),
        email=em,
        website=str(d.get("website") or "").strip(),
        city=str(d.get("city") or seg.city).strip(),
        country=str(d.get("country") or seg.country).strip(),
        source_url=str(d.get("sourceURL") or d.get("sourceUrl") or d.get("url") or "").strip(),
        niche_target_id=seg.niche_target_id,
        status=status,
    )


def generate_buzzwords(settings, niche: str, country: str, want: int = 40) -> list[str]:
    """Ask the LLM for a rich set of search buzzwords/synonyms for a niche, biased toward
    companies that bid on / supply PUBLIC TENDERS (German public sector first). EN + German.
    Returns [] on any failure so the caller falls back to the deterministic expansion."""
    if not settings.llm_base_url:
        return []
    system = (
        "You are a public-procurement market researcher. Given a niche and a target market "
        "(country), output a broad list of SEARCH BUZZWORDS to find companies that could supply "
        "or bid on PUBLIC TENDERS in that niche. Include: niche synonyms, adjacent product/service "
        "terms, and industry jargon, written in BOTH English AND the primary business language of "
        "the target country (e.g. Polish for Poland, German for Germany). Keep each buzzword 1-4 "
        "words, no geography names. Return STRICT JSON only."
    )
    user = (
        f"Niche: {niche}\nTarget market: {country or 'Germany'} (public sector / tenders)\n\n"
        f"Return JSON: {{\"buzzwords\": [\"...\"]}} with {want}+ distinct buzzwords, mixing English "
        f"and the local language of {country or 'Germany'}. JSON only."
    )
    try:
        client = _client(settings)
        resp = client.chat.completions.create(
            model=settings.buzzword_model, temperature=0.5,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        )
        data = _extract_json(resp.choices[0].message.content or "")
        words = data.get("buzzwords", []) if isinstance(data, dict) else []
        out, seen = [], set()
        for w in words:
            w = str(w or "").strip()
            k = w.lower()
            if w and k not in seen and len(w) <= 60:
                seen.add(k)
                out.append(w)
        return out[: max(want, 60)]
    except Exception:
        return []


def research_leads(settings, seg: Segment, search) -> list[Lead]:
    hits = []
    try:
        hits = search.query(f"{seg.niche} companies {seg.city} {seg.country}")[:8]
    except Exception:
        hits = []
    grounding = "\n".join(f"- {h.get('title','')} | {h.get('url','')} | {h.get('content','')}" for h in hits)
    client = _client(settings)
    resp = client.chat.completions.create(
        model=settings.lead_model,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": seg.system_content},
            {"role": "user", "content": seg.user_content + ("\n\nSearch results:\n" + grounding if grounding else "")},
        ],
    )
    data = _extract_json(resp.choices[0].message.content or "")
    leads = data.get("leads", []) if isinstance(data, dict) else []
    return [_lead_from(d, seg) for d in leads if isinstance(d, dict) and (d.get("name"))]


def recover_emails(settings, companies: list[dict], search) -> dict:
    """companies: [{id, name, website, city, country}] -> {id: email}."""
    if not companies:
        return {}
    client = _client(settings)
    lines = [f"{c['id']} | {c['name']} | {c.get('website') or '(no website)'} | {c.get('city','')}, {c.get('country','')}"
             for c in companies]
    system = ("You are a relentless B2B contact researcher. For EACH company find its REAL public "
              "business email (impressum/kontakt/contact, directories, LinkedIn, trade register). "
              "NEVER invent an address. Return STRICT JSON only.")
    user = ("Find the public business email for EACH company below.\nFormat per line: "
            "ID | NAME | WEBSITE | CITY, COUNTRY\n\n" + "\n".join(lines) +
            '\n\nReturn JSON: {"emails":[{"id":0,"email":"found@domain.com"}]} - empty string only if '
            "unverifiable. JSON only.")
    resp = client.chat.completions.create(
        model=settings.email_model, temperature=0.1, response_format={"type": "json_object"},
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    )
    data = _extract_json(resp.choices[0].message.content or "")
    out = {}
    for e in (data.get("emails", []) if isinstance(data, dict) else []):
        if isinstance(e, dict) and "id" in e:
            em, status = email_status(e.get("email"))
            if em and status == "":
                out[int(e["id"])] = em
    return out


# --- offline (deterministic) paths -----------------------------------------

def offline_research(seg: Segment) -> list[Lead]:
    slug = re.sub(r"[^a-z0-9]", "", seg.city.lower()) or "city"
    nslug = re.sub(r"[^a-z0-9]", "", seg.niche_target_phrase.lower()) or "co"
    name = f"{seg.niche_target_phrase.title()} {seg.city} GmbH"
    return [Lead(
        name=name, type=seg.niche_target_name or seg.niche, email=f"info@{nslug}-{slug}.example",
        website=f"https://{nslug}-{slug}.example", city=seg.city, country=seg.country,
        source_url=f"https://{nslug}-{slug}.example", niche_target_id=seg.niche_target_id, status="",
    )]


def offline_recover(companies: list[dict]) -> dict:
    return {}

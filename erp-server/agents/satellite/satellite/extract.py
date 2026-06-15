"""LLM extraction — port of 'Chunk For Extract' + 'Extract Companies (Local AI)'.

The system prompt is VERBATIM from production (tuned against the live campaigns).
brace_slice() is the tolerant JSON rescue: take the substring from the first '{' to the
last '}' — small local models love to wrap JSON in prose despite instructions.

offline_extract() is the --no-llm stand-in: accepts every candidate as a niche match and
copies the name from the page title. It exists to test the pipeline shape in isolation —
its output is NOT judged, so never use it for a live run.
"""
from __future__ import annotations

import json
import re

from .serp import Candidate
from .settings import Settings

SYSTEM_PROMPT = "\n".join([
    "You are a strict data-extraction engine for B2B lead research. You receive a JSON array of WEBSITE CANDIDATES - real pages that were already fetched from the web.",
    "For EACH candidate decide if it is a real COMPANY whose main business matches the target niche, and extract fields.",
    "COPY-ONLY RULE: every value you output must be copied from the candidate data provided (pageTitle, pageText, metaDesc, snippet, emails). NEVER invent, guess or use outside knowledge. If a value is not present in the data, output an empty string.",
    "Respond with a SINGLE valid JSON object and NOTHING ELSE. No markdown fences, no prose.",
    'JSON shape: {"companies":[{"id":"","isCompany":true,"nicheMatch":true,"nicheEvidence":"","name":"","companyType":"","city":"","foundedYear":"","employeeCount":"","email":""}]}',
    "Rules:",
    "- id MUST be one of the provided candidate ids. NEVER create entries that were not in the input.",
    "- isCompany=false for directories, marketplaces, job portals, news sites, blogs, government, schools - AND for non-profits, volunteer communities, foundations and associations.",
    "- nicheMatch=true ONLY if the main business matches the niche. Consider ALL related sub-services and company types of the niche (solutions provider, service provider, consulting, integrator, agency whose core offer IS the niche). A generic web/marketing agency is NOT a software house unless software development is its core offer.",
    "- nicheEvidence: short phrase copied from the page text proving the match.",
    "- name: the official company name as written in pageTitle or pageText.",
    "- companyType: manufacturer / service provider / solutions provider / installer / distributor etc., judged from the page text.",
    "- city: only if a city appears in the page text, else empty.",
    "- foundedYear: only if a founding year is stated in the text.",
    "- employeeCount: only if an employee number is stated in the text.",
    "- email: MUST be one of the candidate emails array values, else empty. Never construct an address.",
])

MAX_TRIES = 2


def candidate_payload(c: Candidate) -> dict:
    return {
        "id": c.id,
        "domain": c.domain,
        "nameGuess": c.name_guess,
        "searchCity": c.city,
        "snippet": c.snippet,
        "pageTitle": c.page_title,
        "metaDesc": c.meta_desc,
        "pageText": c.page_text[:1300],
        "emails": c.emails,
    }


def brace_slice(text: object) -> dict | None:
    if not isinstance(text, str):
        return None
    t = text.strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b <= a:
        return None
    try:
        return json.loads(t[a : b + 1])
    except json.JSONDecodeError:
        return None


def chunked(items: list, size: int) -> list[list]:
    size = max(3, min(15, size))
    return [items[i : i + size] for i in range(0, len(items), size)]


def extract_chunk(
    settings: Settings, chunk: list[Candidate], niche: str, country: str
) -> list[dict] | None:
    """One LLM call over up to extractBatchSize candidates. None = chunk failed."""
    from openai import OpenAI

    if not settings.llm_base_url:
        raise SystemExit("LLM_BASE_URL is not set — use --no-llm or configure the gateway.")
    client = OpenAI(base_url=settings.llm_base_url, api_key=settings.llm_api_key)
    user = (
        f"Target niche: {niche}\n"
        f"Country: {country}\n"
        "Candidates JSON:\n"
        + json.dumps([candidate_payload(c) for c in chunk], ensure_ascii=False)
    )
    for _ in range(MAX_TRIES):
        try:
            response = client.chat.completions.create(
                model=settings.extract_model,
                temperature=0.1,
                max_tokens=4000,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user},
                ],
            )
        except Exception:
            continue
        parsed = brace_slice(response.choices[0].message.content)
        if parsed and isinstance(parsed.get("companies"), list):
            return parsed["companies"]
    return None


def offline_extract(chunk: list[Candidate]) -> list[dict]:
    """--no-llm stand-in: deterministic, accepts everything. Testing only."""
    out = []
    for c in chunk:
        name = re.split(r"[|–—-]", c.page_title or c.name_guess or c.domain)[0].strip()
        out.append({
            "id": c.id,
            "isCompany": True,
            "nicheMatch": True,
            "nicheEvidence": "(offline mode — not judged)",
            "name": name[:120],
            "companyType": "",
            "city": "",
            "foundedYear": "",
            "employeeCount": "",
            "email": c.emails[0] if c.emails else "",
        })
    return out

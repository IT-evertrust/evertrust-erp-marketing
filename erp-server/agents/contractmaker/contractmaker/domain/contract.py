"""Contract field building — port of 'Build Fields' + 'Match Campaign'. Pure logic.

Includes the grounding guard (anti-fabrication): a deal value extracted by the LLM is
accepted only if it literally appears in the aggregated transcript text. Commercial terms
are the hardcoded boilerplate from the n8n node (NOT extracted) — preserved verbatim.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date

STUB_CAMPAIGN_ID = None  # n8n used a STUB Drive folder; in Postgres = no match

# hardcoded commercial terms (verbatim from Build Fields) — fixed boilerplate
COMMERCIAL_TERMS = {
    "TENDER_COUNT": "10", "UPFRONT_FEE": "EUR 5,000.00", "MARKET_ENTRY_FEE": "EUR 2,000.00",
    "PROJECT_FEE": "EUR 3,000.00", "COMMISSION_RATE": "3.5%", "FURTHER_PACKAGE_FEE": "EUR 3,000.00",
    "TESTPHASE_FEE": "500,00 €", "PACKAGE_FEE": "2.990,00 €", "FREE_TENDERS": "5",
    "THRESHOLD_1": "999.000 EUR", "COMMISSION_RATE_1": "3,5 %",
    "THRESHOLD_2": "1.000.000 EUR", "COMMISSION_RATE_2": "2,5 %",
}


def _fold(s: str) -> str:
    x = unicodedata.normalize("NFD", (s or "").lower())
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")
    return x.replace("ł", "l").replace("ø", "o").replace("ß", "ss")


def grounded(value: str, hay_folded: str) -> str:
    """Return value only if its folded form (or any >=4-char token) is in the transcript."""
    v = (value or "").strip()
    if not v:
        return ""
    fv = _fold(v)
    if fv and fv in hay_folded:
        return v
    for tok in re.findall(r"\w+", fv):
        if len(tok) >= 4 and tok in hay_folded:
            return v
    return ""


def niche_match(a: str, b: str) -> bool:
    a, b = (a or "").lower().strip(), (b or "").lower().strip()
    if not a or not b:
        return False
    return a == b or a in b or b in a


def match_campaign(meeting_niche: str, meeting_country: str, campaigns: list[dict]) -> dict | None:
    """Precedence: country+niche -> country -> niche -> None. campaigns: [{id,niche,country}]."""
    mn, mc = (meeting_niche or "").lower().strip(), (meeting_country or "").lower().strip()
    country_hits = [c for c in campaigns if (c.get("country") or "").lower().strip() == mc and mc]
    for c in country_hits:
        if niche_match(mn, c.get("niche", "")):
            return c
    if country_hits:
        return country_hits[0]
    for c in campaigns:
        if niche_match(mn, c.get("niche", "")):
            return c
    return None


def language_of(country: str) -> str:
    c = (country or "").lower()
    return "DE" if ("german" in c or "deutsch" in c) else "EN"


def template_name(niche: str, lang: str) -> str:
    return f"Template_{(niche or 'DEFAULT').strip()}_{lang}"


def build_fields(deal: dict, aggregate_text: str, niche: str, country: str, today: date) -> dict:
    """Build the placeholder->value map for the contract Doc. Grounding-guarded identity
    fields, hardcoded commercial terms, derived language/signature/file base."""
    hay = _fold(aggregate_text)
    lang = language_of(country)

    name = grounded(deal.get("partnerLegalName", ""), hay)
    street = grounded(deal.get("partnerStreet", ""), hay)
    postal_city = grounded(deal.get("partnerPostalCity", ""), hay)
    signatory = grounded(deal.get("partnerSignatory", ""), hay)
    role = grounded(deal.get("partnerSignatoryRole", ""), hay)

    ph = "«Firmenname»" if lang == "DE" else "«Company name»"
    sign_city = re.sub(r"^\d{4,6}\s*,?\s*", "", postal_city).split(",")[0].strip() if postal_city else ""
    display = (name or deal.get("companyName") or "Partner").strip()
    file_base = (f"Vertragsvereinbarung_{display}_EVERTRUST" if lang == "DE"
                 else f"Contract_Agreement_{display}_EN").replace("/", "-")

    fields = {
        "CLIENT_NAME": name or ph,
        "CLIENT_STREET": street or ("«Straße»" if lang == "DE" else "«Street»"),
        "CLIENT_POSTAL_CITY": postal_city or ("«PLZ Ort»" if lang == "DE" else "«Postal city»"),
        "CLIENT_SIGNATORY_TITLE": role or ("Geschäftsführer" if lang == "DE" else "Managing Director"),
        "CLIENT_SIGNATORY": signatory or ("«Unterzeichner»" if lang == "DE" else "«Signatory»"),
        "SIGN_CITY": sign_city or ("«Ort»" if lang == "DE" else "«City»"),
        "SIGN_DATE": today.strftime("%d.%m.%Y"),
        **COMMERCIAL_TERMS,
    }
    return {"fields": fields, "lang": lang, "template_name": template_name(niche, lang),
            "file_base": file_base}

"""Impressum / Kontakt PARSER for LEAD SATELLITE — pulls the REAL company name, a named contact
person, and a phone number out of a page we already scraped (no extra I/O, no LLM).

DACH companies are legally required (§5 DDG in DE, ECG in AT, UWG in CH) to publish an Impressum:
a legal-notice page carrying the registered company name, the managing director(s), and contact
details, all under predictable German labels ("Geschäftsführer:", "Telefon:", …). The email
scraper in scrape.py ALREADY fetches /impressum + /kontakt while hunting for an address; this
module reads the rest of that same HTML so the structured firmographics aren't thrown away.

Pure + regex-only → unit-testable. Niche/country-agnostic and degrades to empties for non-DACH
pages (where no Impressum exists), so it never fabricates: missing data stays missing. Phone is
recovered everywhere (tel: links + labelled numbers); name/contact-person are DACH-tuned.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _text(html: str) -> str:
    s = _TAGS.sub(" ", html or "")
    s = s.replace("&amp;", "&").replace("&#x27;", "'").replace("&quot;", '"').replace("&nbsp;", " ")
    s = re.sub(r"&[a-zA-Z#0-9]+;", " ", s)
    return _WS.sub(" ", s).strip()


@dataclass
class ContactInfo:
    company_name: str = ""   # registered legal name (e.g. "Müller LED-Systeme GmbH")
    contact_name: str = ""   # the named person (Geschäftsführer / Inhaber / V.i.S.d.P.)
    phone: str = ""          # business phone, normalized


# --- phone ------------------------------------------------------------------

# A phone-ish run: optional leading +, then 7..15 digits possibly broken by spaces / () / - / /.
_PHONE_TOKEN = r"\+?\d[\d\s().\/\-]{6,}\d"
_PHONE_LABEL = re.compile(
    r"(?:tel(?:efon)?|telephone|phone|fon|ruf(?:nummer)?|mobil(?:e)?)\b\.?\s*[:.]?\s*(" + _PHONE_TOKEN + r")",
    re.I,
)
_TEL_HREF = re.compile(r'href=["\']tel:([^"\']+)', re.I)
# A line that's a FAX, so we don't hand back a fax number as the contact phone.
_FAX = re.compile(r"(?:fax|telefax)\b", re.I)


def clean_phone(raw: str) -> str:
    """Normalize a captured phone run, or '' if it isn't a plausible 7..15-digit number."""
    s = re.sub(r"[^\d+]", "", (raw or "").replace("(0)", "0"))
    if s.startswith("+"):
        digits = s[1:]
    else:
        digits = s.lstrip("+")
    if not digits.isdigit() or not (7 <= len(digits) <= 15):
        return ""
    # Re-render compactly: keep a leading + if present, group nothing (UI formats later).
    return ("+" + digits) if s.startswith("+") else digits


def extract_phone(html: str) -> str:
    """Best phone from a page: a tel: link first (most reliable), then a labelled 'Telefon:' run.
    Fax numbers are skipped. Returns '' when nothing plausible is found."""
    for m in _TEL_HREF.findall(html or ""):
        p = clean_phone(m)
        if p:
            return p
    text = _text(html)
    for m in _PHONE_LABEL.finditer(text):
        # Skip if this match sits on a Fax label (the regex's own label list excludes fax, but a
        # bare "Fax: 089…" right before could share context — guard the 12 chars ahead of the run).
        lead = text[max(0, m.start() - 12):m.start()]
        if _FAX.search(lead):
            continue
        p = clean_phone(m.group(1))
        if p:
            return p
    return ""


# --- legal company name -----------------------------------------------------

# German/Austrian/Swiss legal forms, longest-first so "GmbH & Co. KG" wins over "GmbH".
_LEGAL_FORMS = (
    r"GmbH\s*&\s*Co\.?\s*KGaA|GmbH\s*&\s*Co\.?\s*KG|AG\s*&\s*Co\.?\s*KG|gGmbH|GmbH|"
    r"UG\s*\(haftungsbeschr[äa]nkt\)|UG|KGaA|KG|OHG|GbR|mbH|AG|SE|e\.\s?K\.|e\.\s?Kfm\.|e\.\s?Kfr\."
)
# A legal form on its own (case-sensitive: AG/SE are upper, so "Magazin" / "agentur" don't match).
# Trailing (?![A-Za-z…]) instead of \b so "e.K." (ends in a dot) still matches.
_FORM_RE = re.compile(r"\b(" + _LEGAL_FORMS + r")(?![A-Za-zÄÖÜäöüß])")
# Explicit "Firma: X" / "Firmenname: X" / "Unternehmen: X" labels (used when no legal form shows).
_FIRMA_LABEL = re.compile(r"(?:firmenname|firma|unternehmen|company)\s*[:.]\s*([^\n,;|]{2,90})", re.I)
# Heading / boilerplate words that sit in front of the real name and must be trimmed off.
_LEAD_NOISE = re.compile(
    r"^(impressum|imprint|kontakt|contact|firma|firmenname|unternehmen|company|angaben|anbieter|"
    r"betreiber|inhaber|name|die|der|das|webseite|website|seite|home|startseite|willkommen|"
    r"adresse|anschrift|verantwortlich)$",
    re.I,
)
# A captured name must not contain these (it'd be address / legal-register noise, not a name).
_NAME_NOISE = re.compile(r"(stra[ßs]e|impressum|kontakt|telefon|e-?mail|angaben|gem[äa][ßs]|inhalt)", re.I)
# Trailing tokens that precede a legal form (capitalized words / digits / & / . / -).
_PRENAME = re.compile(r"([A-Z0-9ÄÖÜ][\wÄÖÜäöüß.&'+\-]*(?:[ ][\wÄÖÜäöüß.&'+\-]+){0,6})\s*$")


def extract_legal_name(html: str) -> str:
    """The registered company name: the token run immediately BEFORE a legal form (looking back so a
    preceding 'Impressum' heading is trimmed, not captured), else a 'Firma:' labelled value, else ''.
    The Impressum leads with the legal name, so the first plausible hit wins."""
    text = _text(html)
    for fm in _FORM_RE.finditer(text):
        window = text[max(0, fm.start() - 70): fm.start()]
        pm = _PRENAME.search(window)
        if not pm:
            continue
        tokens = pm.group(1).split()
        while tokens and (_LEAD_NOISE.match(tokens[0]) or re.fullmatch(r"\d+", tokens[0])):
            tokens.pop(0)
        if not tokens or _NAME_NOISE.search(" ".join(tokens)):
            continue
        # Don't strip a trailing '.' — it's part of forms like "e. K." / "e. Kfm.".
        cand = _WS.sub(" ", " ".join(tokens) + " " + fm.group(1)).strip(" ,;|-")
        if len(cand) >= 4:
            return cand[:120]
    m = _FIRMA_LABEL.search(text)
    if m:
        cand = m.group(1).strip(" .,-")
        if len(cand) >= 3 and not _NAME_NOISE.search(cand):
            return cand[:120]
    return ""


# --- contact person ---------------------------------------------------------

# Labels that introduce the responsible/representing person.
_PERSON_LABEL = re.compile(
    r"(?:vertreten\s+durch|gesch[äa]ftsf[üu]hrer(?:in)?|gesch[äa]ftsf[üu]hrung|inhaber(?:in)?|"
    r"vertretungsberechtigt(?:e[r]?)?|v\.\s?i\.\s?s\.\s?d\.\s?p\.|verantwortlich(?:\s+f[üu]r\s+den\s+inhalt)?|"
    r"ansprechpartner(?:in)?)\s*[:.\-]?\s*",
    re.I,
)
# Role/title words to strip off the front of the captured segment before reading the name.
_ROLE_PREFIX = re.compile(
    r"^\s*(?:den|der|die|des)?\s*"
    r"(?:gesch[äa]ftsf[üu]hrer(?:in)?|gesch[äa]ftsf[üu]hrung|inhaber(?:in)?|vorstand|vorst[äa]ndin|"
    r"direktor(?:in)?|ceo|gf|pers[öo]nlich\s+haftende[r]?\s+gesellschafter(?:in)?|"
    r"dipl\.?-?\s?\w*\.?)\s*[:.\-]?\s*",
    re.I,
)
# An honorific that may precede a name.
_TITLE = r"(?:Herr|Frau|Dr\.|Prof\.|Dr\.-Ing\.|Dipl\.-Ing\.|Mag\.|Ing\.|RA)"
# First + Last (+ optional middle/particle), each capitalized. Allows "von/van/de" particles.
_NAME = re.compile(
    r"(?:" + _TITLE + r"\.?\s+)*"
    r"([A-ZÄÖÜ][a-zäöüß]+(?:\s+(?:von|van|de|der|zu|den))?\s+[A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß]+)?)"
)
_NAME_BAD = re.compile(
    r"\d|@|(?:gmbh|stra[ßs]e|impressum|kontakt|telefon|telefax|umsatzsteuer|registergericht|"
    r"amtsgericht|handelsregister|datenschutz)",
    re.I,
)
# Where a name segment ENDS: the next field label or a separator. Truncating here stops the name
# regex from swallowing a trailing "Kontakt"/"Telefon" as if it were a third name word.
_NAME_STOP = re.compile(
    r"[\n:|·•,;/]|\b(?:kontakt|contact|telefon|tel|telefax|fax|e-?mail|mail|registergericht|"
    r"amtsgericht|handelsregister|umsatzsteuer|ust|anschrift|adresse|postfach|web|www)\b",
    re.I,
)


def extract_contact_person(html: str) -> str:
    """A named person from a representation label ('Geschäftsführer: Thomas Müller'), or ''.
    Strips role/title words, truncates at the next field label, requires a First-Last shape, and
    rejects address/legal noise. Returns the FIRST named person (one contact is enough)."""
    text = _text(html)
    for lm in _PERSON_LABEL.finditer(text):
        seg = _ROLE_PREFIX.sub("", text[lm.end(): lm.end() + 80])
        seg = _NAME_STOP.split(seg, maxsplit=1)[0]
        nm = _NAME.search(seg)
        if not nm:
            continue
        name = _WS.sub(" ", nm.group(1)).strip(" .,-")
        if _NAME_BAD.search(name) or not (4 <= len(name) <= 70):
            continue
        return name
    return ""


def parse_contact(html: str) -> ContactInfo:
    """Read company name + contact person + phone out of one page's HTML (best-effort, all optional).
    Designed for an Impressum/Kontakt page but harmless on any page — fields it can't find stay ''."""
    if not html:
        return ContactInfo()
    return ContactInfo(
        company_name=extract_legal_name(html),
        contact_name=extract_contact_person(html),
        phone=extract_phone(html),
    )

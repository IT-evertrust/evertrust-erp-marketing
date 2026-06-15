"""Email harvesting — verbatim port of the n8n cleanEmail / decodeCf / harvestEmails
logic from 'Prep Candidates' / 'Mine Contact Emails'.

Pure functions, no I/O.
"""
from __future__ import annotations

import re

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
CF_RE = re.compile(r'(?:data-cfemail="|/cdn-cgi/l/email-protection#)([0-9a-fA-F]{6,})')
MAILTO_RE = re.compile(r"mailto:[^\"'>\s?]+", re.IGNORECASE)
_VALID_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")

BAD_SUBSTRINGS = [
    "example.", "sentry", "wixpress", "no-reply", "noreply", "domain.com",
    ".png", ".jpg", ".gif", ".svg", "@2x", "protected", "your-email", "email@",
]

GENERIC_PREFIX_RE = re.compile(
    r"^(office|info|kontakt|contact|sales|hello|biuro|vertrieb|sekretariat)@", re.IGNORECASE
)
PERSON_RE = re.compile(r"^[a-z]+[._-][a-z]+@", re.IGNORECASE)


def clean_email(e: object, extra_bad: tuple[str, ...] = ()) -> str:
    if not e:
        return ""
    s = str(e).strip()
    s = re.sub(r"^mailto:", "", s, flags=re.IGNORECASE).split("?")[0].strip()
    s = re.sub(r"^[\[\"'<(]+", "", s)
    s = re.sub(r"[\]\"')>.,;:]+$", "", s)
    if not _VALID_RE.match(s):
        return ""
    low = s.lower()
    for b in list(BAD_SUBSTRINGS) + list(extra_bad):
        if b in low:
            return ""
    return s


def decode_cf(hex_blob: str) -> str:
    """Cloudflare cfemail XOR decode: first byte is the key, rest is key-XORed ASCII."""
    try:
        if not hex_blob or len(hex_blob) < 6 or len(hex_blob) % 2:
            return ""
        key = int(hex_blob[0:2], 16)
        out = []
        for i in range(2, len(hex_blob), 2):
            c = int(hex_blob[i : i + 2], 16) ^ key
            if c < 9 or c > 126:
                return ""
            out.append(chr(c))
        return "".join(out)
    except ValueError:
        return ""


def harvest_emails(html: str, dom: str) -> list[str]:
    """cfemail-decode + mailto + plain-text regex, dedup, rank, top 3.

    Ranking (lower score = better): -3 if the email's domain contains the site-domain
    stem, -1.5 if it looks like firstname.lastname, -1 for a generic office/info prefix.
    """
    found: list[str] = []
    for m in CF_RE.findall(html or ""):
        e = clean_email(decode_cf(m))
        if e:
            found.append(e)
    for m in MAILTO_RE.findall(html or ""):
        e = clean_email(m)
        if e:
            found.append(e)
    for m in EMAIL_RE.findall(html or ""):
        e = clean_email(m)
        if e:
            found.append(e)
    uniq: list[str] = []
    for e in found:
        if e not in uniq:
            uniq.append(e)
    key = (dom or "").split(".")[0]

    def score(x: str) -> float:
        s = 0.0
        domain_part = x.split("@")[1] if "@" in x else ""
        if key and key in domain_part:
            s -= 3
        if PERSON_RE.match(x):
            s -= 1.5
        if GENERIC_PREFIX_RE.match(x):
            s -= 1
        return s

    uniq.sort(key=score)
    return uniq[:3]

"""Email hygiene — verbatim port of the cleanEmail/isValidEmail logic from the n8n
'Code — Collect Leads' / 'Code — Compute Action' nodes.

Harvested leads contain typographic characters that Gmail rejects as invalid addresses
(the original bug class: U+2011 non-breaking hyphen). Dash variants become ASCII '-',
nbsp/zero-width characters are removed.
"""
from __future__ import annotations

import re

_DASH_VARIANTS = "‐‑‒–—―−﹘﹣－"
_INVISIBLES = " ​‌‍⁠﻿"

_DASH_RE = re.compile(f"[{_DASH_VARIANTS}]")
_INVISIBLE_RE = re.compile(f"[{_INVISIBLES}]")
# Same pattern as the n8n node: ^[^\s@]+@[^\s@]+\.[^\s@]{2,}$
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def clean_email(raw: object) -> str:
    s = "" if raw is None else str(raw)
    s = _DASH_RE.sub("-", s)
    s = _INVISIBLE_RE.sub("", s)
    return s.strip()


def is_valid_email(email: str) -> bool:
    return bool(_EMAIL_RE.match(email))

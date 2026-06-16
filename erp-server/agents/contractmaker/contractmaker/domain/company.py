"""Company-name normalization — verbatim port of the n8n `companyKey` / `norm` logic.
Shared concept with CRM (both match leads↔meetings by this key)."""
from __future__ import annotations

import re
import unicodedata

_LEGAL_FORMS = ["sp. z o.o.", "sp.z o.o.", "sp z o o", "gmbh"]


def company_key(name: str) -> str:
    x = unicodedata.normalize("NFD", (name or "").lower())
    x = "".join(c for c in x if unicodedata.category(c) != "Mn")  # strip diacritics
    for form in _LEGAL_FORMS:
        x = x.replace(form, " ")
    return re.sub(r"[^a-z0-9]", "", x)

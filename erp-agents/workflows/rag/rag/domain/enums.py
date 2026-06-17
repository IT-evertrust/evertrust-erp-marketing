"""Closed enums + inbox routing. Port of the n8n 'Send From' routing and the
unsureArea closed set from the 'Build Hermes Prompt' / output-contract."""
from __future__ import annotations

# The closed set the model's `unsureArea` must belong to (verbatim from the prompt).
UNSURE_AREAS = {
    "Finance",
    "Operation",
    "Organization",
    "Legality",
    "Reference - Past Projects/Wins",
}

# Full mailbox addresses (mirrors settings.sender_addresses; kept here for pure routing).
HANNA_ADDRESS = "hanna@evertrust-germany.de"
INFO_ADDRESS = "info@evertrust-germany.de"


def route_inbox(send_from: object) -> str:
    """n8n 'Send From' routing: any value containing 'hanna' (case-insensitive) → Hanna's
    mailbox; everything else (incl. blank / None) → info@. Returns the full address."""
    value = str(send_from or "").strip().lower()
    return HANNA_ADDRESS if "hanna" in value else INFO_ADDRESS


def account_for(send_from: object) -> str:
    """Which Gmail token to use: 'hanna' | 'info'."""
    return "hanna" if "hanna" in str(send_from or "").lower() else "info"

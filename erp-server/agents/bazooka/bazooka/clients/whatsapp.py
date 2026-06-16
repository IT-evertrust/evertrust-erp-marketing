"""Manager notifications via WhatsApp — port of the five 'WA — *' nodes.

Two providers supported because the n8n credential was ambiguous (node configured for
Meta Cloud API, author note says 360dialog). Pick via WHATSAPP_PROVIDER in .env.

In dry-run the pipeline never calls this; messages go to the run report instead.
"""
from __future__ import annotations


def notify(settings, text: str) -> None:
    import httpx  # lazy import: not needed for dry runs

    if not settings.whatsapp_api_key:
        return  # best-effort: WhatsApp notifications are optional; skip when unconfigured

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": settings.manager_whatsapp_number,
        "type": "text",
        "text": {"body": text},
    }
    if settings.whatsapp_provider == "360dialog":
        url = "https://waba-v2.360dialog.io/messages"
        headers = {"D360-API-KEY": settings.whatsapp_api_key}
    else:  # meta cloud api
        url = f"https://graph.facebook.com/v19.0/{settings.sender_phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {settings.whatsapp_api_key}"}

    response = httpx.post(url, json=payload, headers=headers, timeout=30)
    response.raise_for_status()

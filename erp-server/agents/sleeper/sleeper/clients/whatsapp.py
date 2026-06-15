from __future__ import annotations


def notify(settings, text: str) -> None:
    import httpx

    if not settings.whatsapp_api_key:
        raise SystemExit("WHATSAPP_API_KEY is not set — required for live notifications.")
    payload = {
        "messaging_product": "whatsapp", "recipient_type": "individual",
        "to": settings.manager_whatsapp_number, "type": "text", "text": {"body": text},
    }
    if settings.whatsapp_provider == "360dialog":
        url = "https://waba-v2.360dialog.io/messages"
        headers = {"D360-API-KEY": settings.whatsapp_api_key}
    else:
        url = f"https://graph.facebook.com/v19.0/{settings.sender_phone_number_id}/messages"
        headers = {"Authorization": f"Bearer {settings.whatsapp_api_key}"}
    httpx.post(url, json=payload, headers=headers, timeout=30).raise_for_status()

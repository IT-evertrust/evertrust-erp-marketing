"""One-time Gmail OAuth consent flow per sender account.

Usage:  python -m bazooka.auth info     # log in as info@evertrust-germany.de
        python -m bazooka.auth hanna    # log in as hanna@evertrust-germany.de

Needs client_secret.json (OAuth client of type 'Desktop app' from the Google Cloud
console) in the package root. Stores the refresh token in tokens/<account>.json.
n8n's stored OAuth tokens are NOT portable — this flow replaces them.
"""
from __future__ import annotations

import sys
from pathlib import Path

from .settings import load_settings

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def main() -> None:
    from google_auth_oauthlib.flow import InstalledAppFlow

    if len(sys.argv) != 2 or sys.argv[1] not in ("info", "hanna"):
        raise SystemExit("Usage: python -m bazooka.auth <info|hanna>")
    account = sys.argv[1]
    settings = load_settings()

    secret = Path(settings.google_client_secret_file)
    if not secret.exists():
        raise SystemExit(
            f"Missing {secret}. Create an OAuth client (Desktop app) in the Google Cloud "
            "console with the Gmail API enabled, download the JSON, and save it there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES)
    creds = flow.run_local_server(port=0)

    token_dir = Path(settings.gmail_token_dir)
    token_dir.mkdir(parents=True, exist_ok=True)
    token_file = token_dir / f"{account}.json"
    token_file.write_text(creds.to_json())
    print(f"Token saved: {token_file}")
    print(f"Make sure you logged in as {settings.sender_addresses[account]}.")


if __name__ == "__main__":
    main()

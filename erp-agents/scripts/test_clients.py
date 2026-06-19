import argparse
import sys
from pathlib import Path

from rich import print

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from erp_agents.clients import (
    ErpClient,
    GmailClient,
    GoogleCalendarClient,
    GoogleDocsClient,
    LlmClient,
    SearchClient,
    WhatsAppClient,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--client",
        required=True,
        choices=[
            "llm",
            "erp",
            "gmail",
            "calendar",
            "docs",
            "search",
            "whatsapp",
        ],
    )

    args = parser.parse_args()

    if args.client == "llm":
        client = LlmClient()
        result = client.complete_json(
            system_prompt="Return JSON only.",
            user_prompt='Return {"ok": true, "client": "llm"}.',
        )
        print(result)

    if args.client == "erp":
        client = ErpClient()
        result = client.get("/growth/reach/aims")
        print(result)

    if args.client == "gmail":
        client = GmailClient()
        print("Gmail client initialized successfully.")

    if args.client == "calendar":
        client = GoogleCalendarClient()
        print("Calendar client initialized successfully.")

    if args.client == "docs":
        client = GoogleDocsClient()
        print("Docs client initialized successfully.")

    if args.client == "search":
        client = SearchClient()
        result = client.search("Evertrust GmbH", limit=3)
        print(result)

    if args.client == "whatsapp":
        client = WhatsAppClient()
        print("WhatsApp client initialized successfully.")


if __name__ == "__main__":
    main()
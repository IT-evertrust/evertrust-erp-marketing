"""CLI for Reply Glock. Dry-run by default (classify + decide, no sends/bookings/writes).
--live arms Gmail/Calendar/ERP writes.

    python -m glock                              # dry-run (needs a Gmail token to fetch replies)
    python -m glock --no-llm                     # offline keyword classify (no gateway)
    python -m glock --live                       # arm all effects
    python -m glock --no-llm --fixture replies.json   # no Gmail: feed canned replies (demo/test)

--fixture loads inbound replies from a JSON file instead of Gmail, so the full
classify+route logic can be exercised against the live ERP with zero credentials.
Each item: {"messageId","fromEmail","subject","replyText","account"} (account defaults to "info").
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients import calendar, gmail, llm, whatsapp
from .clients.erp import ErpClient
from .domain.models import Reply
from .pipeline import RunOptions, run
from .settings import load_settings


class FixtureGmail:
    """Stand-in Gmail that yields replies from a JSON file. Side-effecting methods are
    no-ops, so it's only meaningful in dry-run (sends/drafts/bookings are live-gated)."""

    def __init__(self, path: str) -> None:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        items = raw.get("replies", raw) if isinstance(raw, dict) else raw
        self._replies = [
            Reply(
                message_id=str(it.get("messageId") or it.get("message_id") or f"fix-{i}"),
                thread_id=str(it.get("threadId") or it.get("thread_id") or f"t-fix-{i}"),
                from_email=str(it.get("fromEmail") or it.get("from_email") or it.get("email") or ""),
                subject=str(it.get("subject") or "Re: Tenders"),
                reply_text=str(it.get("replyText") or it.get("reply_text") or it.get("text") or ""),
                account=str(it.get("account") or "info"),
            )
            for i, it in enumerate(items)
        ]

    def fetch_replies(self, settings, account, query):
        return [r for r in self._replies if r.account == account]

    def mark_read(self, settings, account, message_id):  # no-op
        return None

    def create_draft(self, settings, account, to, thread_id, subject, body_html):  # no-op
        return "fixture-draft"

    def send_reply(self, settings, account, to, thread_id, subject, body_html):  # no-op
        return "fixture-sent"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="glock", description="REPLY GLOCK — handle inbound replies")
    p.add_argument("--live", action="store_true", help="arm sends/bookings/ERP writes (default: dry)")
    p.add_argument("--no-llm", action="store_true", help="offline keyword classify (no gateway)")
    p.add_argument("--fixture", help="JSON file of canned replies instead of Gmail (demo/test)")
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(live=args.live, use_llm=not args.no_llm)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    gmail_provider = FixtureGmail(args.fixture) if args.fixture else gmail
    try:
        result = run(settings, opts, erp, gmail_provider, calendar, llm, whatsapp)
        # With a fixture, show the per-reply routing — that's the visible result.
        if args.fixture:
            print(json.dumps(result, indent=2))
        else:
            print(json.dumps({k: v for k, v in result.items() if k != "replies"}, indent=2))
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

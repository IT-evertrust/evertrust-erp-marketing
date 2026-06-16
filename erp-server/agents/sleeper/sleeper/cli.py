"""CLI for Sleeper. Dry-run by default (sweep + draft, writes nothing). --live arms suppression,
re-engage send, and prospect status writes.

    python -m sleeper               # dry-run
    python -m sleeper --no-llm      # offline draft (no gateway)
    python -m sleeper --live        # arm all effects
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients import gmail, llm, whatsapp
from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sleeper", description="SLEEPER GRENADE — re-engage snooze-due prospects")
    p.add_argument("--live", action="store_true", help="arm suppression/send/writes (default: dry)")
    p.add_argument("--no-llm", action="store_true", help="offline deterministic draft (no gateway)")
    p.add_argument("--limit", type=int, default=100)
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(live=args.live, use_llm=not args.no_llm, limit=args.limit)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp, llm, gmail, whatsapp)
        print(json.dumps({k: v for k, v in result.items() if k != "prospects"}, indent=2))
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

"""CLI. Dry-run by default (classify + decide, no sends/bookings/writes). --live arms.

    python -m glock                       # poll Gmail, dry-run
    python -m glock --no-llm              # offline heuristic classifier (needs --seed or Gmail)
    python -m glock --live                # the real thing (15-min cron runs this)
"""
from __future__ import annotations

import argparse
import sys
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

from .pipeline import RunOptions, run
from .settings import TZ, load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="glock", description="REPLY GLOCK reply-handling run")
    parser.add_argument("--live", action="store_true", help="arm sends/bookings/writes (default: dry)")
    parser.add_argument("--no-llm", action="store_true", help="offline keyword classifier (testing)")
    parser.add_argument("--account", action="append", choices=["info", "hanna"],
                        help="limit to one inbox (repeatable); default both")
    args = parser.parse_args(argv)

    settings = load_settings()
    if args.live and args.no_llm:
        raise SystemExit("--live with --no-llm is forbidden: the offline classifier is unjudged.")

    opts = RunOptions(
        live=args.live, use_llm=not args.no_llm,
        accounts=tuple(args.account) if args.account else ("info", "hanna"),
    )
    try:
        run(settings, opts)
        return 0
    except SystemExit:
        raise
    except Exception as exc:
        traceback.print_exc()
        if args.live:
            try:
                from .clients import whatsapp
                whatsapp.notify(
                    settings,
                    "Weapon jammed\nWorkflow: glock (python)\n"
                    f"Time: {datetime.now(ZoneInfo(TZ)).isoformat()}\n\nError: {str(exc)[:400]}",
                )
            except Exception:
                print("(error alert via WhatsApp also failed)", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

"""CLI. Dry-run by default (compute the plan, no drafts/writes). --live arms Gmail draft
creation + DB writes. --no-llm uses the deterministic offline stub. --campaign filters.

    python -m rag                         # dry-run plan, writes/sends nothing
    python -m rag --no-llm                # offline stub instead of calling hermes
    python -m rag --campaign 7            # one campaign only
    python -m rag --live                  # the real thing (drafts only, never sends)
"""
from __future__ import annotations

import argparse
import sys
import traceback

from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rag", description="RAG AGENT unsure-lead draft run")
    parser.add_argument("--live", action="store_true",
                        help="arm Gmail draft creation + DB writes (default: dry)")
    parser.add_argument("--no-llm", action="store_true",
                        help="deterministic offline stub instead of calling hermes (testing)")
    parser.add_argument("--campaign", type=int, default=None,
                        help="limit to one campaign id (default: all active)")
    args = parser.parse_args(argv)

    settings = load_settings()
    if args.live and args.no_llm:
        raise SystemExit("--live with --no-llm is forbidden: the offline stub is unjudged.")

    opts = RunOptions(
        live=args.live, use_llm=not args.no_llm, campaign_id=args.campaign,
    )
    try:
        run(settings, opts)
        return 0
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

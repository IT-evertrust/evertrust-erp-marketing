"""CLI. Dry-run by default (research happens, nothing is written to the DB).

    python -m satellite --campaign "DEMO PL CYBERSECURITY" --max-queries 6 --no-llm
    python -m satellite --campaign "PL CYBERSECURITY" --live
"""
from __future__ import annotations

import argparse
import sys

from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="satellite", description="LEAD SATELLITE research run")
    parser.add_argument("--campaign", required=True, help="campaign name (exact, case-insensitive)")
    parser.add_argument("--live", action="store_true", help="insert leads into the DB")
    parser.add_argument("--force", action="store_true", help="hunt even if leads already exist")
    parser.add_argument("--no-llm", action="store_true",
                        help="offline extraction — accepts everything, testing only")
    parser.add_argument("--queries-per-city", type=int, default=2)
    parser.add_argument("--max-queries", type=int, default=600)
    parser.add_argument("--max-candidates", type=int, default=1000)
    parser.add_argument("--max-cities", type=int, default=0, help="0 = unlimited")
    parser.add_argument("--extract-batch-size", type=int, default=8)
    parser.add_argument("--fast", action="store_true",
                        help="drop SERP politeness delay to 0.4s (testing only)")
    args = parser.parse_args(argv)

    settings = load_settings()
    if args.fast:
        object.__setattr__(settings, "serp_delay_s", 0.4)
    if args.live and args.no_llm:
        raise SystemExit("--live with --no-llm is forbidden: offline extraction is unjudged.")

    opts = RunOptions(
        campaign=args.campaign,
        live=args.live,
        force=args.force,
        use_llm=not args.no_llm,
        queries_per_city=args.queries_per_city,
        max_queries=args.max_queries,
        max_candidates=args.max_candidates,
        max_cities=args.max_cities,
        extract_batch_size=args.extract_batch_size,
    )
    try:
        run(settings, opts)
        return 0
    except SystemExit:
        raise
    except Exception:
        import traceback

        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

"""CLI for Satellite. Dry-run by default (research + build prospects, writes nothing).
--live bulk-posts prospects to the ERP + run callback.

    python -m satellite --campaign-id <id>                 # dry-run
    python -m satellite --campaign-id <id> --no-llm        # offline (no gateway/search)
    python -m satellite --campaign-id <id> --max-segments 4
    python -m satellite --campaign-id <id> --live          # bulk-post to ERP
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients.erp import ErpClient
from .clients.search import HttpFetcher, OfflineFetcher, OfflineSearch, SearxngClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="satellite", description="LEAD SATELLITE — hunt prospects")
    p.add_argument("--campaign-id", required=True)
    p.add_argument("--live", action="store_true", help="bulk-post prospects to the ERP (default: dry)")
    p.add_argument("--no-llm", action="store_true", help="offline deterministic research (no gateway)")
    p.add_argument("--max-segments", type=int, default=None)
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(
        campaign_id=args.campaign_id, live=args.live, use_llm=not args.no_llm,
        max_segments=args.max_segments,
    )
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    if args.no_llm:
        search, fetcher = OfflineSearch(), OfflineFetcher()
    else:
        search, fetcher = SearxngClient(settings.searxng_url, settings.arsenal_token), HttpFetcher()
    try:
        result = run(settings, opts, erp, search, fetcher)
        print(json.dumps(result, indent=2))
        return 0 if result.get("status") in ("ok", "no_targets", "no_segments") else 1
    finally:
        for gw in (erp, search, fetcher):
            close = getattr(gw, "close", None)
            if callable(close):
                close()


if __name__ == "__main__":
    sys.exit(main())

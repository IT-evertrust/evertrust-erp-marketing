"""CLI for Sales Agent. Feeds a transcript (file or stdin) through the scoring pipeline.
Dry-run by default (analyze, don't persist). --live persists (non-erp sources).

    python -m sales --transcript-file mtg.txt --persona "Alex Hormozi" --source manual
    cat mtg.txt | python -m sales --no-llm
    python -m sales --transcript-file mtg.txt --source manual --live
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients import llm
from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sales", description="SALES AGENT — Hormozi-lens meeting coach")
    p.add_argument("--transcript-file", help="path to a transcript text file (else read stdin)")
    p.add_argument("--persona", default="Alex Hormozi")
    p.add_argument("--source", default="manual", help="erp (return JSON) | readai | manual (persist)")
    p.add_argument("--live", action="store_true", help="persist the analysis (non-erp sources)")
    p.add_argument("--no-llm", action="store_true", help="offline deterministic coach (no gateway)")
    args = p.parse_args(argv)

    text = open(args.transcript_file).read() if args.transcript_file else sys.stdin.read()

    settings = load_settings()
    opts = RunOptions(transcript=text, persona=args.persona, source=args.source,
                      live=args.live, use_llm=not args.no_llm)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp, llm)
        print(json.dumps({k: v for k, v in result.items() if k not in ("analysis", "row")}, indent=2))
        return 0 if result.get("status") in ("ok", "invalid") else 1
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

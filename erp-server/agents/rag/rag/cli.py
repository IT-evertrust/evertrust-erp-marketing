"""CLI for RAG Agent. Dry-run by default (draft only, writes nothing). --live saves the draft
back to the ERP + notifies.

    python -m rag             # dry-run
    python -m rag --no-llm    # offline deterministic draft (no gateway)
    python -m rag --live      # save suggestedReply + notify
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
    p = argparse.ArgumentParser(prog="rag", description="RAG AGENT — draft replies for unsure leads")
    p.add_argument("--live", action="store_true", help="save drafts to the ERP + notify (default: dry)")
    p.add_argument("--no-llm", action="store_true", help="offline deterministic draft (no gateway)")
    p.add_argument("--limit", type=int, default=50)
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(live=args.live, use_llm=not args.no_llm, limit=args.limit)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp, llm)
        print(json.dumps({k: v for k, v in result.items() if k != "drafts"}, indent=2))
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

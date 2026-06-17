"""CLI for ContractMaker. Feeds a Read.ai meeting JSON (file or stdin) through the pipeline.
Dry-run by default (extract + match + build fields, no PDF/writes). --live arms PDF + ERP writes.

    python -m contractmaker --meeting-file mtg.json            # dry-run
    cat mtg.json | python -m contractmaker --no-llm            # offline, from stdin
    python -m contractmaker --meeting-file mtg.json --live      # generate + record + sign
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients import gdocs, llm
from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="contractmaker", description="ContractMaker — generate signed contract")
    p.add_argument("--meeting-file", help="path to a Read.ai meeting JSON (else read stdin)")
    p.add_argument("--live", action="store_true", help="generate PDF + record/sign in ERP (default: dry)")
    p.add_argument("--no-llm", action="store_true", help="offline extraction (no gateway)")
    args = p.parse_args(argv)

    raw = open(args.meeting_file).read() if args.meeting_file else sys.stdin.read()
    meeting = json.loads(raw) if raw.strip() else {}

    settings = load_settings()
    opts = RunOptions(meeting=meeting, live=args.live, use_llm=not args.no_llm)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp, llm, gdocs)
        print(json.dumps(result, indent=2))
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

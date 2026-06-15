"""CLI. Feeds a Read.ai (or ERP) meeting JSON through the scoring pipeline. Dry-run by
default (logs + plan, no DB writes, no LLM-less surprises). --live arms the DB write.

    python -m sales --sample                 # built-in sample_readai.json, dry-run, offline
    python -m sales --input payload.json      # score a Read.ai/ERP webhook body JSON
    python -m sales --input payload.json --no-llm
    python -m sales --input payload.json --live
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from .pipeline import RunOptions, score
from .settings import PACKAGE_ROOT, load_settings

SAMPLE_PATH = PACKAGE_ROOT / "sample_readai.json"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="sales", description="Sales Agent transcript scorer")
    p.add_argument("--input", help="path to a Read.ai/ERP webhook payload JSON")
    p.add_argument("--sample", action="store_true",
                   help="use the built-in sample_readai.json (implies --no-llm)")
    p.add_argument("--live", action="store_true", help="arm the DB write (meeting_analyses)")
    p.add_argument("--no-llm", action="store_true",
                   help="use the deterministic offline stub instead of calling the model")
    args = p.parse_args(argv)

    use_llm = not args.no_llm
    if args.sample:
        body = json.loads(SAMPLE_PATH.read_text())
        use_llm = False  # sample is a dry, offline smoke test
    elif args.input:
        body = json.loads(Path(args.input).read_text())
    else:
        raise SystemExit("Provide --input PATH or --sample.")

    settings = load_settings()
    try:
        score(settings, RunOptions(live=args.live, use_llm=use_llm), body)
        return 0
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

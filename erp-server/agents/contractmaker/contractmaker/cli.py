"""CLI. Feeds a Read.ai meeting JSON (file or stdin) through the pipeline. Dry-run by
default (logs + plan, no DB writes, no PDF). --live arms.

    python -m contractmaker --meeting-file meeting.json
    python -m contractmaker --meeting-file meeting.json --live
    python -m contractmaker --sample            # built-in test meeting
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback

from .pipeline import RunOptions, handle_meeting
from .settings import load_settings

SAMPLE = {
    "title": "EVERTRUST × Baltic Boxes — cooperation",
    "summary": "Discussed container tender cooperation. Both sides agreed to sign the cooperation contract now.",
    "session_id": "sample-001",
    "transcript": {"speaker_blocks": [
        {"speaker": {"name": "Hanna"}, "words": "Great, so we are aligned on the 3.5% commission."},
        {"speaker": {"name": "Partner"}, "words": "Yes, Baltic Boxes Sp. z o.o. agrees to sign the contract today."},
    ]},
}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="contractmaker", description="ContractMaker meeting handler")
    p.add_argument("--meeting-file", help="path to a Read.ai webhook body JSON")
    p.add_argument("--sample", action="store_true", help="use the built-in sample meeting")
    p.add_argument("--live", action="store_true", help="arm DB writes + PDF generation")
    p.add_argument("--no-llm", action="store_true", help="offline signing heuristic (testing)")
    args = p.parse_args(argv)

    if args.live and args.no_llm:
        raise SystemExit("--live with --no-llm is forbidden: offline signing detection is unjudged.")
    if args.sample:
        body = SAMPLE
    elif args.meeting_file:
        body = json.loads(open(args.meeting_file).read())
    else:
        raise SystemExit("Provide --meeting-file PATH or --sample.")

    settings = load_settings()
    try:
        handle_meeting(settings, RunOptions(live=args.live, use_llm=not args.no_llm), body)
        return 0
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

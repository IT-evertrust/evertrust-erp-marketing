"""CLI. Dry-run by default (computes intake + graduation, writes nothing). --live upserts.

    python -m crm            # dry-run CRM report
    python -m crm --live     # upsert hot_leads + graduate customers
"""
from __future__ import annotations

import argparse
import sys
import traceback

from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="crm", description="CRM hot-leads intake + graduation")
    p.add_argument("--live", action="store_true", help="arm hot_leads + customers upserts")
    args = p.parse_args(argv)
    settings = load_settings()
    try:
        run(settings, RunOptions(live=args.live))
        return 0
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())

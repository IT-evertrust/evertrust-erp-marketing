"""CLI. Dry-run by default (evaluates and reports, changes nothing). --live arms the
re-engage updates and the archive+delete of do-not-contacts.

    python -m sleeper            # dry-run sweep report
    python -m sleeper --live     # actually re-engage / suppress
"""
from __future__ import annotations

import argparse
import sys
import traceback

from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sleeper", description="SLEEPER GRENADE snooze/suppression sweep")
    parser.add_argument("--live", action="store_true", help="arm re-engage + archive/delete (default: dry)")
    args = parser.parse_args(argv)

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

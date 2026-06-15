"""CLI. Dry-run by default (researches news + plans templates, writes nothing). --live arms.

    python -m ammoforge                       # all campaigns, dry-run
    python -m ammoforge --campaign "X" --no-llm
    python -m ammoforge --live                # write news_intel + forge templates
    python -m ammoforge --live --no-forge     # only refresh news_intel
"""
from __future__ import annotations

import argparse
import sys
import traceback

from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ammoforge", description="AMMO FORGE news + template forge")
    p.add_argument("--live", action="store_true", help="arm news_intel + templates writes")
    p.add_argument("--campaign", help="only this campaign (exact, case-insensitive)")
    p.add_argument("--no-llm", action="store_true", help="offline: no news, unpolished masters (testing)")
    p.add_argument("--no-forge", action="store_true", help="skip the template forge, news only")
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(live=args.live, use_llm=not args.no_llm, campaign=args.campaign,
                      forge_templates=not args.no_forge)
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

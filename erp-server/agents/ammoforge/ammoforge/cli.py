"""CLI for AmmoForge. Dry-run by default (research + forge, prints templates, writes nothing).
--live posts templates to the ERP + notifies.

    python -m ammoforge --campaign-id <id>            # dry-run
    python -m ammoforge --campaign-id <id> --no-llm   # offline forge (no gateway)
    python -m ammoforge --campaign-id <id> --live      # forge + POST templates to ERP
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ammoforge", description="AMMO FORGE — forge campaign templates")
    p.add_argument("--campaign-id", required=True, help="campaign id to forge templates for")
    p.add_argument("--live", action="store_true", help="POST templates to the ERP (default: dry-run)")
    p.add_argument("--no-llm", action="store_true", help="offline deterministic forge (no gateway)")
    args = p.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(campaign_id=args.campaign_id, live=args.live, use_llm=not args.no_llm)
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp)
        print(json.dumps({k: v for k, v in result.items() if k != "templates"}, indent=2))
        if result.get("status") != "ok":
            return 1
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

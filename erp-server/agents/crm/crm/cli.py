"""CLI for CRM Customer. Dry-run by default (computes intake + graduation, writes nothing).
--live upserts hot-leads + customers to the ERP.

    python -m crm            # dry-run
    python -m crm --live     # upsert
"""
from __future__ import annotations

import argparse
import json
import sys

from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import load_settings


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="crm", description="CRM Customer — intake hot leads + graduate customers")
    p.add_argument("--live", action="store_true", help="upsert hot-leads/customers (default: dry)")
    args = p.parse_args(argv)

    settings = load_settings()
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, RunOptions(live=args.live), erp)
        print(json.dumps({k: v for k, v in result.items() if k not in ("hotLeads", "customers")}, indent=2))
        return 0
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

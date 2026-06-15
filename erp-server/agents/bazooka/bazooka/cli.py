"""CLI entry point (handy for manual runs / cron). Dry-run is the default; --live arms
Gmail sends and ERP writes (POST /outreach-messages, PATCH /prospects/:id, run callback).

    python -m bazooka                          # dry-run: full fire plan, zero side effects
    python -m bazooka --no-llm                 # dry-run without the LiteLLM gateway
    python -m bazooka --live --campaign X --limit 3   # supervised first live run
    python -m bazooka --live                   # the real thing

The reach logic itself is `pipeline.run()`; the ERP usually calls it via the FastAPI route
(bazooka.server). On a live failure we POST an ERROR run callback + WhatsApp alert.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime
from zoneinfo import ZoneInfo

from .clients.erp import ErpClient
from .pipeline import RunOptions, run
from .settings import TZ, load_settings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bazooka", description="REACH BAZOOKA outbound run")
    parser.add_argument("--live", action="store_true", help="actually send (default: dry-run)")
    parser.add_argument("--campaign", help="only this campaign (name/project, case-insensitive)")
    parser.add_argument("--limit", type=int, help="max emails this run")
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="skip the LLM, fill placeholders deterministically (isolated testing)",
    )
    args = parser.parse_args(argv)

    settings = load_settings()
    opts = RunOptions(
        live=args.live, campaign=args.campaign, limit=args.limit, use_llm=not args.no_llm
    )
    erp = ErpClient(settings.erp_base_url, settings.arsenal_token)
    try:
        result = run(settings, opts, erp)
        print(json.dumps(result.get("counts", {})))
        print(f"Report: {result.get('reportPath')}")
        return 0
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        if args.live:
            try:
                erp.post_run_callback("ERROR", {}, str(exc))
            except Exception:
                pass
            try:
                from .clients import whatsapp

                whatsapp.notify(
                    settings,
                    "Weapon jammed\nWorkflow: reach-bazooka (python)\n"
                    f"Time: {datetime.now(ZoneInfo(TZ)).isoformat()}\n\nError: {str(exc)[:400]}",
                )
            except Exception:
                print("(error alert via WhatsApp also failed)", file=sys.stderr)
        return 1
    finally:
        erp.close()


if __name__ == "__main__":
    sys.exit(main())

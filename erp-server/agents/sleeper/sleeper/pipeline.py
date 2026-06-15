"""The sweep loop. One pass over all not-interested leads: route each, then re-engage
due snoozes and archive+delete do-not-contacts. Dry-run default; --live arms writes."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import db
from .domain.sweep import route_lead
from .settings import TZ, Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False


def run(settings: Settings, opts: RunOptions) -> dict:
    now = datetime.now(ZoneInfo(TZ))
    today = now.date()
    run_id = "sleeper-" + now.strftime("%Y-%m-%d-%H%M%S")
    report = [f"# Sleeper Grenade run {run_id} ({'live' if opts.live else 'dry'})", ""]
    counts = {"reengage": 0, "delete": 0, "skip": 0}

    def log(msg: str) -> None:
        print(msg, flush=True)
        report.append(f"- {msg}")

    conn = db.connect(settings.database_url)
    targets = db.fetch_targets(conn)
    log(f"[scan] {len(targets)} not-interested leads to evaluate")

    for lead in targets:
        action, detail = route_lead(lead["status"], today, lead.get("snooze_until"))
        counts[action] += 1
        if action == "reengage":
            log(f"REENGAGE {lead['company_name']} <{lead['email']}> — {detail}")
            if opts.live:
                db.reengage(conn, run_id, lead, detail)
        elif action == "delete":
            log(f"SUPPRESS {lead['company_name']} <{lead['email']}> — {detail} "
                "(soft-suppress: do_not_contact=true)")
            if opts.live:
                db.archive_and_delete(conn, run_id, lead, detail)
        else:
            log(f"skip {lead['company_name']} <{lead['email']}> — {detail}")

    conn.close()
    summary = (f"Sweep complete\nRe-engaged: {counts['reengage']} | "
               f"Suppressed: {counts['delete']} | Left: {counts['skip']}")
    log(f"[summary] {counts}")
    if opts.live and (counts["reengage"] or counts["delete"]):
        from .clients import whatsapp
        whatsapp.notify(settings, summary)

    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(report) + "\n")
    print(f"Run report: {path}")
    print(f"Counts: {counts}")
    return counts

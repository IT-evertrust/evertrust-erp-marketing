"""The CRM brain. Reads all meetings + existing customers once, then per campaign computes
hot-lead intake and customer graduation, and upserts. Dry-run default; --live writes."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import db
from .domain.state import compute
from .settings import Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False


def run(settings: Settings, opts: RunOptions) -> dict:
    run_id = "crm-" + datetime.now().strftime("%Y-%m-%d-%H%M%S")
    report = [f"# CRM run {run_id} ({'live' if opts.live else 'dry'})", ""]
    summary = {"campaigns": 0, "hot": 0, "graduated": 0}

    def log(m: str) -> None:
        print(m, flush=True)
        report.append(f"- {m}")

    conn = db.connect(settings.database_url)
    meetings = db.meetings_by_company_key(conn)
    customers = db.existing_customer_emails(conn)
    log(f"[load] {sum(len(v) for v in meetings.values())} meetings across "
        f"{len(meetings)} companies; {len(customers)} existing customers")

    for campaign in db.fetch_campaigns(conn):
        summary["campaigns"] += 1
        leads = db.fetch_leads(conn, campaign["id"])
        hot_rows, cust_rows = compute(campaign, leads, meetings, customers)
        log(f"=== {campaign['name']}: {len(hot_rows)} hot, {len(cust_rows)} to graduate ===")
        for h in hot_rows:
            tag = "SIGNED" if h["contract_status"] == "Signed" else h["hot_reason"]
            log(f"  hot [{tag}] {h['company_name']} <{h['email']}> status={h['lead_status']!r}")
            if opts.live:
                db.upsert_hot_lead(conn, h)
        for c in cust_rows:
            customers.add(c["email"].lower())  # avoid double-graduation within this run
            log(f"  GRADUATE -> customer {c['company_name']} <{c['email']}> term={c['cooperation_term']!r}")
            if opts.live:
                db.upsert_customer(conn, c)
        summary["hot"] += len(hot_rows)
        summary["graduated"] += len(cust_rows)

    conn.close()
    log(f"[summary] {summary}" + ("" if opts.live else "  (dry — nothing written)"))
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(report) + "\n")
    print(f"Run report: {path}")
    print(f"Summary: {summary}")
    return summary

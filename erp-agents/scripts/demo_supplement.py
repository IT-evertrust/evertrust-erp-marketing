"""Supplement the bazooka demo campaign with the lead states + signed meeting needed to
exercise Sleeper (snooze/DNC) and CRM (hot-lead intake + customer graduation) in dry-run.
Idempotent. Run with any agent venv after bazooka/seed_demo.py. Writes only demo rows."""
from __future__ import annotations

import os
from pathlib import Path

import psycopg


def _database_url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    # The DB belongs to its owner (the ERP). These dev-only seed/clean scripts read
    # DATABASE_URL from erp-server/.env — the agents themselves never touch the DB
    # directly (they go through the ERP machine API). See repo-root CONFIG.md.
    # This file lives at erp-agents/scripts/, so erp-server/.env is three levels up.
    env = Path(__file__).resolve().parent.parent.parent / "erp-server" / ".env"
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL=") and not line.startswith("#"):
            return line.partition("=")[2].strip()
    raise SystemExit("DATABASE_URL not found in env or erp-server/.env")


URL = _database_url()
CAMP = "DEMO PL CYBERSECURITY"

EXTRA_LEADS = [
    # (company, type, email, status, country)
    ("Snoozer Co",   "service provider", "snooze@demo.pl",   "Not Interested - Snoozed 2026-05-01", "Poland"),
    ("NoContact Co", "service provider", "dnc@demo.pl",      "Not Interested - Do Not Contact",     "Poland"),
    ("Hot Interested Co", "service provider", "hot@demo.pl",  "Interested",         "Poland"),
    ("Meeting Co",   "service provider", "deal@demo.pl",     "Meeting Scheduled",  "Poland"),
]

with psycopg.connect(URL, autocommit=True) as c:
    cid = c.execute("SELECT id FROM campaigns WHERE name=%s", (CAMP,)).fetchone()
    if not cid:
        raise SystemExit(f"Campaign {CAMP!r} not found — run bazooka/seed_demo.py first.")
    cid = cid[0]

    # extra leads (clean re-insert by email within this campaign)
    emails = tuple(e for _, _, e, _, _ in EXTRA_LEADS)
    c.execute("DELETE FROM leads WHERE campaign_id=%s AND email = ANY(%s)", (cid, list(emails)))
    for company, ctype, email, status, country in EXTRA_LEADS:
        c.execute(
            """INSERT INTO leads (campaign_id, company_name, company_type, email, status, country)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (cid, company, ctype, email, status, country),
        )

    # a signed meeting for "Meeting Co" -> CRM graduation + matches ContractMaker company_key
    c.execute("DELETE FROM meetings WHERE company_key=%s", ("meetingco",))
    c.execute(
        """INSERT INTO meetings (company_key, company_name, country, niche, campaign_id,
                                 meeting_ref, meeting_date, title, sign_now, meeting_outcome,
                                 cooperation_term)
           VALUES ('meetingco','Meeting Co','Poland','cybersecurity',%s,
                   'demo-mtg-1','2026-06-10','Closing call', true, 'signed', '12 months')""",
        (cid,),
    )
    print(f"Supplement seeded into campaign #{cid}: +4 leads (snooze/DNC/interested/meeting), +1 signed meeting.")

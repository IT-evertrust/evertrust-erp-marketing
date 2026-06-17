"""Remove ALL demo/test artifacts from the database, leaving it pristine. Idempotent."""
from __future__ import annotations

import os
from pathlib import Path

import psycopg

DEMO_CAMPAIGNS = ("DEMO PL CYBERSECURITY", "RAG Demo Campaign")
# order matters: everything referencing campaigns(id) must go before campaigns itself
CHILD_TABLES = ["send_log", "outreach_threads", "hot_leads", "unsure_analysis",
                "news_intel", "templates", "contracts", "meetings", "leads"]


def _url() -> str:
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    # DB belongs to the ERP; dev-only scripts read it from erp-server/.env. The 9
    # agents never touch the DB directly (ERP machine API only). See CONFIG.md.
    # This file lives at erp-agents/scripts/, so erp-server/.env is three levels up.
    env = Path(__file__).resolve().parent.parent.parent / "erp-server" / ".env"
    for line in env.read_text().splitlines():
        if line.startswith("DATABASE_URL=") and not line.strip().startswith("#"):
            return line.partition("=")[2].strip()
    raise SystemExit("DATABASE_URL not found in env or erp-server/.env")


with psycopg.connect(_url(), autocommit=True) as c:
    ids = [r[0] for r in c.execute(
        "SELECT id FROM campaigns WHERE name = ANY(%s)", (list(DEMO_CAMPAIGNS),)).fetchall()]
    deleted = {}
    if ids:
        for t in CHILD_TABLES:
            try:
                cur = c.execute(f"DELETE FROM {t} WHERE campaign_id = ANY(%s)", (ids,))
                deleted[t] = cur.rowcount
            except psycopg.errors.UndefinedColumn:
                pass
        deleted["campaigns"] = c.execute(
            "DELETE FROM campaigns WHERE id = ANY(%s)", (ids,)).rowcount
    # standalone demo rows
    deleted["meetings"] = c.execute("DELETE FROM meetings WHERE company_key = 'meetingco'").rowcount
    deleted["contracts"] = c.execute("DELETE FROM contracts WHERE company_key = 'meetingco'").rowcount
    deleted["customers"] = c.execute("DELETE FROM customers WHERE email LIKE '%@demo.pl'").rowcount
    deleted["proposed_slots"] = c.execute("DELETE FROM proposed_slots WHERE lead_email LIKE '%@demo.pl' OR lead_email LIKE '%asseco.pl' OR lead_email LIKE '%dagma.eu' OR lead_email LIKE '%cybernat.pl'").rowcount
    deleted["processed_replies"] = c.execute("DELETE FROM processed_replies WHERE workflow = 'glock'").rowcount
    deleted["runs"] = c.execute("DELETE FROM runs WHERE workflow = 'bazooka'").rowcount
    deleted["personas"] = c.execute("DELETE FROM personas WHERE name = 'Alex Hormozi'").rowcount
    deleted["knowledge_docs"] = c.execute("DELETE FROM knowledge_docs WHERE name = 'Evertrust_Knowledge_Base'").rowcount

print("Cleaned:", {k: v for k, v in deleted.items() if v})

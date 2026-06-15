"""Repository. Reads not-interested leads; soft-suppresses (leads.do_not_contact) or
re-engages. The live schema has NO suppressed_leads/sweep_log tables — per the agreed
design we reuse leads.do_not_contact instead of archive-then-delete (no data loss)."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

# not-interested leads NOT already suppressed — keeps the scan tight and idempotent
TARGET_SQL = """
    SELECT id, campaign_id, company_name, company_type, email, status, notes,
           website, city, country, tier, snooze_until
    FROM leads
    WHERE lower(status) LIKE 'not interested%%'
      AND do_not_contact IS NOT TRUE
    ORDER BY id
"""


def connect(database_url: str) -> psycopg.Connection:
    # autocommit=True so each `with conn.transaction()` block is a real top-level
    # transaction that commits on exit. Without it, an earlier SELECT opens an implicit
    # transaction and later writes become savepoints that roll back on close.
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def fetch_targets(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(TARGET_SQL).fetchall()


def reengage(conn: psycopg.Connection, run_id: str, lead: dict, detail: str) -> None:
    """Due snooze -> reset to '' (Bazooka will cold-outreach again), clear snooze + DNC flags.
    run_id/detail kept in the signature for the pipeline; no separate sweep_log in this schema."""
    with conn.transaction():
        conn.execute(
            "UPDATE leads SET status = '', notes = '', snooze_until = NULL, "
            "do_not_contact = false WHERE id = %s",
            (lead["id"],),
        )


def archive_and_delete(conn: psycopg.Connection, run_id: str, lead: dict, detail: str) -> None:
    """Do-not-contact -> SOFT-suppress by setting leads.do_not_contact = true. Keeps the row
    (and its history) but removes it from every agent's active scan. Replaces the old
    archive-to-suppressed_leads-then-DELETE (those tables don't exist in the live schema)."""
    with conn.transaction():
        conn.execute(
            "UPDATE leads SET do_not_contact = true WHERE id = %s", (lead["id"],)
        )

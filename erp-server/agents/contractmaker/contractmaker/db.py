"""Repository. Writes the meetings log (CRM reads it), checks/sets the per-company
idempotency lock, reads campaigns for matching, records generated contracts."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def log_meeting(conn, row: dict) -> None:
    # Live `meetings` uses `meeting_ref` (not meeting_id) and has no `processed` column —
    # the per-company idempotency lock lives on contracts.company_key (UNIQUE) instead.
    with conn.transaction():
        conn.execute(
            """INSERT INTO meetings
                 (company_key, company_name, country, niche, meeting_ref, meeting_date,
                  title, transcript, sign_now, meeting_outcome, cooperation_term)
               VALUES (%(company_key)s, %(company_name)s, %(country)s, %(niche)s, %(meeting_id)s,
                       %(meeting_date)s, %(title)s, %(transcript)s, %(sign_now)s,
                       %(meeting_outcome)s, %(cooperation_term)s)""",
            row,
        )


def company_history(conn, company_key: str) -> list[dict]:
    return conn.execute(
        "SELECT * FROM meetings WHERE company_key = %s ORDER BY meeting_date NULLS LAST, id",
        (company_key,),
    ).fetchall()


def any_processed(conn, company_key: str) -> bool:
    # The lock is now "a contract row already exists for this company" (contracts.company_key
    # is UNIQUE), replacing the removed meetings.processed flag.
    return conn.execute(
        "SELECT 1 FROM contracts WHERE company_key = %s LIMIT 1", (company_key,)
    ).fetchone() is not None


def mark_processed(conn, company_key: str) -> None:
    # No-op: recording the contract row (record_contract) IS the lock now. Kept for the
    # pipeline call site; safe to remove once the pipeline drops the call.
    return None


def fetch_campaigns(conn) -> list[dict]:
    return conn.execute(
        "SELECT id, coalesce(niche,'') AS niche, coalesce(country,'') AS country FROM campaigns"
    ).fetchall()


def record_contract(conn, company_key, company_name, campaign_id, template_name, pdf_ref, fields) -> None:
    # NOTE: the live `contracts` table is still DRIVE-SHAPED (drive_doc_id / drive_pdf_id /
    # partner_*) and has no column for the generated document or fields. Until it's reshaped
    # to store the PDF (bytea) + fields jsonb, we only write the identity columns; company_key
    # UNIQUE is the idempotency lock. pdf_ref/fields are accepted but NOT yet persisted.
    with conn.transaction():
        conn.execute(
            """INSERT INTO contracts (company_key, company_name, campaign_id, template_name)
               VALUES (%s, %s, %s, %s) ON CONFLICT (company_key) DO NOTHING""",
            (company_key, company_name, campaign_id, template_name),
        )

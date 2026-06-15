"""Repository layer. Replaces all the n8n Drive/Sheets I/O with Postgres reads/writes
against the live schema (campaigns, leads, knowledge_docs, unsure_analysis). All SQL here.

autocommit=True is CRITICAL: a prior production bug had a SELECT open an implicit
transaction, after which writes silently rolled back. With autocommit on, reads are
plain and every write is wrapped in `with conn.transaction():`."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def list_campaigns(conn: psycopg.Connection, campaign_id: int | None = None) -> list[dict]:
    """Active campaigns (optionally one). Replaces 'List Campaign Folders'."""
    if campaign_id is not None:
        rows = conn.execute(
            "SELECT id, name, active, sender FROM campaigns WHERE id = %s",
            (campaign_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, name, active, sender FROM campaigns WHERE active = true ORDER BY id"
        ).fetchall()
    return rows


def get_unsure_lead_rows(conn: psycopg.Connection, campaign_id: int) -> list[dict]:
    """Raw lead rows for a campaign (status filtering/dedupe happens in domain.select).
    Replaces 'Read Leads (Unsure)'. Selects only live-schema columns."""
    return conn.execute(
        """SELECT id, campaign_id, company_name, email, status, country, send_from
           FROM leads
           WHERE campaign_id = %s AND lower(trim(coalesce(status,''))) = 'unsure'
           ORDER BY id""",
        (campaign_id,),
    ).fetchall()


def load_knowledge_doc(conn: psycopg.Connection, cap: int, name: str = "Evertrust_Knowledge_Base") -> str:
    """Load the grounding doc and truncate to `cap` chars. Replaces the Drive download +
    HTML-to-Text nodes. Fail-loud if the doc is missing."""
    row = conn.execute(
        "SELECT content FROM knowledge_docs WHERE name = %s", (name,)
    ).fetchone()
    if row is None:
        raise RuntimeError(f"knowledge_docs row {name!r} not found — cannot ground the model.")
    content = row.get("content") or ""
    return content[:cap]


def dedup_key_seen(conn: psycopg.Connection, dedup_key: str) -> bool:
    """Idempotency check (fixes the DISABLED 'Skip Seen Messages' node)."""
    return conn.execute(
        "SELECT 1 FROM unsure_analysis WHERE thread_dedup_key = %s LIMIT 1", (dedup_key,)
    ).fetchone() is not None


def insert_unsure_analysis(conn: psycopg.Connection, row: dict) -> int:
    """Append an analysis row. Replaces the 'Append to Unsure Analysis' sheet write."""
    with conn.transaction():
        res = conn.execute(
            """INSERT INTO unsure_analysis
                 (campaign_id, lead_id, client_email, company_name, unsure_section,
                  category, draft_subject, drafted_reply, scanned_from, thread_dedup_key)
               VALUES (%(campaign_id)s, %(lead_id)s, %(client_email)s, %(company_name)s,
                       %(unsure_section)s, %(category)s, %(draft_subject)s, %(drafted_reply)s,
                       %(scanned_from)s, %(thread_dedup_key)s)
               RETURNING id""",
            row,
        ).fetchone()
    return res["id"]

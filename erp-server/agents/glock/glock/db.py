"""Repository layer. Reads leads/outreach_threads (Bazooka's output), writes status +
pending_slots + processed_replies. All SQL lives here."""
from __future__ import annotations

import json
from datetime import datetime

import psycopg
from psycopg.rows import dict_row

from .domain.models import Lead, Slot


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def lead_by_thread(conn: psycopg.Connection, thread_id: str) -> Lead | None:
    """Primary linkage (the upgrade n8n never did): match the reply's Gmail threadId
    to the outreach we sent, via leads.thread_id or the outreach_threads map."""
    row = conn.execute(
        """SELECT l.id, l.campaign_id, l.company_name, l.company_type, l.email, l.status,
                  l.notes, c.sender, coalesce(c.niche,'') AS niche,
                  coalesce(c.project,'') AS project, c.name AS campaign_name
           FROM leads l JOIN campaigns c ON c.id = l.campaign_id
           WHERE l.thread_id = %s
              OR lower(l.email) = (SELECT lower(email) FROM outreach_threads
                                   WHERE thread_id = %s LIMIT 1)
           LIMIT 1""",
        (thread_id, thread_id),
    ).fetchone()
    return _to_lead(row)


def lead_by_email(conn: psycopg.Connection, email: str) -> Lead | None:
    """Fallback linkage when no thread match (matches the n8n behavior)."""
    row = conn.execute(
        """SELECT l.id, l.campaign_id, l.company_name, l.company_type, l.email, l.status,
                  l.notes, c.sender, coalesce(c.niche,'') AS niche,
                  coalesce(c.project,'') AS project, c.name AS campaign_name
           FROM leads l JOIN campaigns c ON c.id = l.campaign_id
           WHERE lower(l.email) = lower(%s) ORDER BY l.id LIMIT 1""",
        (email,),
    ).fetchone()
    return _to_lead(row)


def already_processed(conn: psycopg.Connection, message_id: str) -> bool:
    # Live processed_replies is a shared dedup ledger keyed on (workflow, dedup_key);
    # Glock uses the Gmail message_id as the dedup_key.
    return conn.execute(
        "SELECT 1 FROM processed_replies WHERE workflow = 'glock' AND dedup_key = %s",
        (message_id,),
    ).fetchone() is not None


def mark_processed(
    conn: psycopg.Connection, message_id: str, thread_id: str, lead_email: str, classification: str
) -> None:
    # The live table stores only (workflow, dedup_key, lead_email); thread_id/classification
    # have no column — kept in the signature for caller compatibility.
    with conn.transaction():
        conn.execute(
            """INSERT INTO processed_replies (workflow, dedup_key, lead_email)
               VALUES ('glock', %s, %s) ON CONFLICT (workflow, dedup_key) DO NOTHING""",
            (message_id, lead_email),
        )


def set_status(conn: psycopg.Connection, lead_id: int, status: str, notes: str) -> None:
    with conn.transaction():
        conn.execute(
            "UPDATE leads SET status = %s, notes = %s WHERE id = %s", (status, notes, lead_id)
        )


def store_pending_slots(
    conn: psycopg.Connection, lead_email: str, campaign_id: int, slot1: Slot, slot2: Slot
) -> None:
    # Live table is `proposed_slots` with structured slot columns (no JSON blobs, no
    # unique on lead_email, no campaign_id) — re-propose = delete prior then insert.
    with conn.transaction():
        conn.execute("DELETE FROM proposed_slots WHERE lead_email = %s", (lead_email.lower(),))
        conn.execute(
            """INSERT INTO proposed_slots
                 (lead_email, slot1_start, slot1_end, slot1_human,
                  slot2_start, slot2_end, slot2_human, status, proposed_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'proposed', %s)""",
            (lead_email.lower(), slot1.start, slot1.end, slot1.human,
             slot2.start, slot2.end, slot2.human, datetime.now()),
        )


def get_pending_slots(conn: psycopg.Connection, lead_email: str) -> tuple[dict, dict] | None:
    row = conn.execute(
        """SELECT slot1_start, slot1_end, slot1_human, slot2_start, slot2_end, slot2_human
           FROM proposed_slots WHERE lead_email = %s AND status = 'proposed'
           ORDER BY proposed_at DESC LIMIT 1""",
        (lead_email.lower(),),
    ).fetchone()
    if not row:
        return None
    # rebuild the {start,end,human} dicts the booking path expects (ISO strings)
    def iso(v):
        return v.isoformat() if v is not None else ""
    slot1 = {"start": iso(row["slot1_start"]), "end": iso(row["slot1_end"]), "human": row["slot1_human"] or ""}
    slot2 = {"start": iso(row["slot2_start"]), "end": iso(row["slot2_end"]), "human": row["slot2_human"] or ""}
    return slot1, slot2


def _to_lead(row: dict | None) -> Lead | None:
    if row is None:
        return None
    return Lead(
        id=row["id"], campaign_id=row["campaign_id"],
        company_name=row["company_name"] or "", company_type=row["company_type"] or "",
        email=row["email"] or "", status=row["status"] or "", notes=row["notes"] or "",
        sender="hanna" if "hanna" in (row["sender"] or "info").lower() else "info",
        niche=row["niche"], project=row["project"], campaign_name=row["campaign_name"] or "",
    )

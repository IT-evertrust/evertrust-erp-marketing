""" Repository layer — ALL SQL lives here. Implements the data contract from
REACH_BAZOOKA_PYTHON_PLAN.md section 3.
"""
from __future__ import annotations

import json
from datetime import date, datetime

import psycopg
from psycopg.rows import dict_row

from .domain.models import Campaign, Lead, News, Template, Templates


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def fetch_active_campaigns(conn: psycopg.Connection) -> list[Campaign]:
    rows = conn.execute(
        """SELECT id, name, coalesce(niche,'') AS niche, coalesce(target,'') AS target,
                  coalesce(country,'') AS country, coalesce(region,'') AS region,
                  coalesce(project,'') AS project, sender,
                  coalesce(gmail_label,'') AS gmail_label,
                  coalesce(sales_calendar_id,'') AS sales_calendar_id
           FROM campaigns WHERE active ORDER BY name"""
    ).fetchall()
    return [Campaign(**row) for row in rows]


def fetch_leads(conn: psycopg.Connection, campaign_id: int) -> list[Lead]:
    rows = conn.execute(
        """SELECT id, campaign_id, company_name, company_type, email, status,
                  date_sent, thread_id, notes
           FROM leads WHERE campaign_id = %s ORDER BY id""",
        (campaign_id,),
    ).fetchall()
    return [Lead(**row) for row in rows]


def fetch_templates(conn: psycopg.Connection, campaign_id: int) -> Templates:
    rows = conn.execute(
        "SELECT block, subject, body FROM templates WHERE campaign_id = %s",
        (campaign_id,),
    ).fetchall()
    return {row["block"]: Template(row["subject"], row["body"]) for row in rows}


def fetch_news(conn: psycopg.Connection, campaign_id: int) -> News:
    row = conn.execute(
        """SELECT body, is_bad_news FROM news_intel
           WHERE campaign_id = %s ORDER BY created_at DESC LIMIT 1""",
        (campaign_id,),
    ).fetchone()
    return News(row["body"], row["is_bad_news"]) if row else News()


def already_sent_today(
    conn: psycopg.Connection, lead_id: int, action_type: str, today: date
) -> bool:
    row = conn.execute(
        "SELECT 1 FROM send_log WHERE lead_id = %s AND action_type = %s AND sent_on = %s",
        (lead_id, action_type, today),
    ).fetchone()
    return row is not None


def mark_sent(
    conn: psycopg.Connection,
    lead: Lead,
    campaign_id: int,
    action_type: str,
    new_status: str,
    today: date,
    email: str,
    message_id: str,
    thread_id: str,
) -> None:
    """Send bookkeeping in ONE transaction: idempotency log + lead status + thread map.

    Called only after the Gmail send succeeded; a crash before this commits means the
    next run sees the old status and the send_log check — at most one resend window,
    versus the n8n version where every step was a separate failure point.
    """
    with conn.transaction():
        conn.execute(
            """INSERT INTO send_log
                 (lead_id, campaign_id, action_type, sent_on, gmail_message_id, gmail_thread_id)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (lead.id, campaign_id, action_type, today, message_id, thread_id),
        )
        conn.execute(
            "UPDATE leads SET status = %s, date_sent = %s, thread_id = %s WHERE id = %s",
            (new_status, today, thread_id, lead.id),
        )
        conn.execute(
            """INSERT INTO outreach_threads (email, thread_id, message_id, kind)
               VALUES (%s, %s, %s, 'outreach')
               ON CONFLICT (email, thread_id) DO NOTHING""",
            (email.lower(), thread_id, message_id),
        )


def log_error(
    conn: psycopg.Connection, campaign: str, lead_email: str, step: str, reason: str
) -> None:
    with conn.transaction():
        conn.execute(
            "INSERT INTO error_log (campaign, lead_email, step, reason) VALUES (%s, %s, %s, %s)",
            (campaign, lead_email, step, reason),
        )


def record_run_start(
    conn: psycopg.Connection, run_id: str, started_at: datetime, mode: str
) -> None:
    with conn.transaction():
        conn.execute(
            "INSERT INTO runs (run_id, workflow, started_at, mode) VALUES (%s, %s, %s, %s)",
            (run_id, "bazooka", started_at, mode),
        )


def record_run_finish(
    conn: psycopg.Connection, run_id: str, finished_at: datetime, counts: dict
) -> None:
    with conn.transaction():
        conn.execute(
            "UPDATE runs SET finished_at = %s, counts = %s WHERE run_id = %s",
            (finished_at, json.dumps(counts), run_id),
        )

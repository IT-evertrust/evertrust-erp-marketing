"""Repository. Reads personas, writes meeting_analyses, logs parse failures to error_log.

autocommit=True is critical: a SELECT opens an implicit transaction and, without it, later
writes silently roll back. Writes are wrapped in `with conn.transaction():`."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from .domain.models import PersonaMatch


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def list_personas(conn) -> list[dict]:
    return conn.execute(
        "SELECT id, name, prompt FROM personas ORDER BY name"
    ).fetchall()


def resolve_persona(conn, requested: str) -> PersonaMatch | None:
    """§5 resolution: exact -> substring -> fallback-first. FIX (blueprint #2): NO silent
    fallback — fallback_first is recorded as match_type and surfaced loudly by the caller.
    Returns None only if no personas exist at all."""
    personas = list_personas(conn)
    if not personas:
        return None

    target = (requested or "").strip().lower()

    # 1. exact name match
    for p in personas:
        if (p["name"] or "").strip().lower() == target:
            return PersonaMatch(p["id"], p["name"], requested, "exact", p["prompt"] or "")

    # 2. substring match (first hit)
    for p in personas:
        if target and target in (p["name"] or "").strip().lower():
            return PersonaMatch(p["id"], p["name"], requested, "substring", p["prompt"] or "")

    # 3. fallback to first (loud — recorded as fallback_first)
    p = personas[0]
    return PersonaMatch(p["id"], p["name"], requested, "fallback_first", p["prompt"] or "")


def insert_meeting_analysis(conn, row: dict, transcript: str, report_html: str,
                            generated_at) -> int:
    """Insert one clean meeting_analyses row (§6.10 column set). Returns the new id."""
    with conn.transaction():
        rec = conn.execute(
            """INSERT INTO meeting_analyses
                 (client_name, ae_name, meeting_date, summary, strengths, weaknesses,
                  performance_score, understanding_client_needs, communication,
                  technical_explanation, aggressiveness, client_score, client_buying_intent,
                  client_interest, client_communication, persona, transcript, report_html,
                  source, generated_at)
               VALUES (%(client_name)s, %(ae_name)s, %(meeting_date)s, %(summary)s,
                       %(strengths)s, %(weaknesses)s, %(performance_score)s,
                       %(understanding_client_needs)s, %(communication)s,
                       %(technical_explanation)s, %(aggressiveness)s, %(client_score)s,
                       %(client_buying_intent)s, %(client_interest)s, %(client_communication)s,
                       %(persona)s, %(transcript)s, %(report_html)s, %(source)s, %(generated_at)s)
               RETURNING id""",
            {**row, "transcript": transcript, "report_html": report_html,
             "generated_at": generated_at},
        ).fetchone()
    return rec["id"]


def log_error(conn, campaign: str, lead_email: str, step: str, reason: str) -> None:
    """Record a parse failure (or other error) to error_log. workflow is fixed to 'sales'."""
    with conn.transaction():
        conn.execute(
            """INSERT INTO error_log (workflow, campaign, lead_email, step, reason)
               VALUES (%s, %s, %s, %s, %s)""",
            ("sales", campaign, lead_email, step, reason),
        )

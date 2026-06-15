"""Repository. Reads leads + meetings (ContractMaker's table) + customers (dedup);
upserts hot_leads + customers."""
from __future__ import annotations

from datetime import datetime

import psycopg
from psycopg.rows import dict_row

from .domain.state import norm


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def fetch_campaigns(conn) -> list[dict]:
    return conn.execute(
        "SELECT id, name, coalesce(niche,'') AS niche, coalesce(project,'') AS project "
        "FROM campaigns WHERE active ORDER BY name").fetchall()


def fetch_leads(conn, campaign_id: int) -> list[dict]:
    return conn.execute(
        """SELECT id AS lead_id, company_name, company_type, email, status,
                  website, city, country, tier
           FROM leads WHERE campaign_id = %s""", (campaign_id,)).fetchall()


def meetings_by_company_key(conn) -> dict[str, list[dict]]:
    """All meetings, grouped by company_key, sorted by date — for Meeting 1-5 + signing.
    Returns {} gracefully if the meetings table doesn't exist yet (ContractMaker not run)."""
    try:
        rows = conn.execute(
            """SELECT company_key, company_name, meeting_date, title, meeting_outcome,
                      sign_now, cooperation_term
               FROM meetings ORDER BY meeting_date NULLS LAST, id""").fetchall()
    except psycopg.errors.UndefinedTable:
        return {}
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        key = r["company_key"] or norm(r["company_name"] or "")
        grouped.setdefault(key, []).append({**r, "meeting_date": str(r["meeting_date"] or "")})
    return grouped


def existing_customer_emails(conn) -> set[str]:
    rows = conn.execute("SELECT email FROM customers").fetchall()
    return {(r["email"] or "").strip().lower() for r in rows}


def upsert_hot_lead(conn, row: dict) -> None:
    cols = ["campaign_id", "lead_id", "company_name", "company_type", "email", "website",
            "city", "country", "tier", "niche", "source_campaign", "hot_reason",
            "meeting_date", "lead_status", "note", "final_meeting", "contract_status"]
    placeholders = ", ".join(f"%({c})s" for c in cols)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ("campaign_id", "email"))
    with conn.transaction():
        conn.execute(
            f"INSERT INTO hot_leads ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT (campaign_id, email) DO UPDATE SET {updates}, detected_at = now()",
            row,
        )


def upsert_customer(conn, row: dict) -> None:
    cols = ["company_name", "company_type", "email", "website", "city", "country", "tier",
            "niche", "source_campaign", "stage", "hot_reason", "owner", "notes",
            "meeting_date", "cooperation_term", "contract_status"]
    placeholders = ", ".join(f"%({c})s" for c in cols)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "email")
    with conn.transaction():
        conn.execute(
            f"INSERT INTO customers ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT (email) DO UPDATE SET {updates}, updated_at = now()",
            row,
        )

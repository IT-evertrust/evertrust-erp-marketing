"""Repository layer. Reads campaigns from the shared contract (bazooka/schema.sql +
schema_additions.sql), writes leads. The skip-if-exists guard replaces the n8n Drive
search for an existing leads sheet."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from .validate import LeadRow


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def fetch_campaign(conn: psycopg.Connection, name: str) -> dict | None:
    return conn.execute(
        """SELECT id, name, coalesce(niche,'') AS niche, coalesce(country,'') AS country,
                  coalesce(region,'') AS region, coalesce(project,'') AS project, sender
           FROM campaigns WHERE active AND lower(name) = lower(%s)""",
        (name,),
    ).fetchone()


def campaign_has_leads(conn: psycopg.Connection, campaign_id: int) -> int:
    row = conn.execute(
        "SELECT count(*) AS n FROM leads WHERE campaign_id = %s", (campaign_id,)
    ).fetchone()
    return row["n"]


def existing_domains(conn: psycopg.Connection, campaign_id: int) -> set[str]:
    rows = conn.execute(
        "SELECT website FROM leads WHERE campaign_id = %s AND website <> ''",
        (campaign_id,),
    ).fetchall()
    out = set()
    for r in rows:
        d = r["website"].split("://")[-1].replace("www.", "").split("/")[0]
        if d:
            out.add(d)
    return out


def insert_leads(conn: psycopg.Connection, campaign_id: int, rows: list[LeadRow]) -> int:
    """Insert researched leads, skipping domains already present in the campaign
    (improvement over n8n, which created a whole new sheet on FORCE_REHUNT)."""
    skip = existing_domains(conn, campaign_id)
    inserted = 0
    with conn.transaction():
        for r in rows:
            dom = r.website.split("://")[-1].replace("www.", "").split("/")[0]
            if dom in skip:
                continue
            conn.execute(
                """INSERT INTO leads
                     (campaign_id, company_name, company_type, email, status,
                      website, city, country, tier)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (campaign_id, r.company_name, r.company_type, r.email, r.status,
                 r.website, r.city, r.country, r.tier),
            )
            skip.add(dom)
            inserted += 1
    return inserted

"""Repository. Writes news_intel + templates (both Bazooka reads). Idempotent template
forge: skip when the campaign already has templates."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    return psycopg.connect(database_url, row_factory=dict_row, autocommit=True)


def fetch_campaigns(conn, only: str | None = None) -> list[dict]:
    if only:
        return conn.execute(
            "SELECT id, name, coalesce(niche,'') AS niche, coalesce(region,'') AS region, "
            "coalesce(country,'') AS country, coalesce(project,'') AS project "
            "FROM campaigns WHERE active AND lower(name)=lower(%s)", (only,)).fetchall()
    return conn.execute(
        "SELECT id, name, coalesce(niche,'') AS niche, coalesce(region,'') AS region, "
        "coalesce(country,'') AS country, coalesce(project,'') AS project "
        "FROM campaigns WHERE active ORDER BY name").fetchall()


def write_news_intel(conn, campaign_id: int, body: str, is_bad_news: bool) -> None:
    with conn.transaction():
        conn.execute(
            "INSERT INTO news_intel (campaign_id, body, is_bad_news) VALUES (%s, %s, %s)",
            (campaign_id, body, is_bad_news),
        )


def has_templates(conn, campaign_id: int) -> bool:
    return conn.execute(
        "SELECT 1 FROM templates WHERE campaign_id = %s LIMIT 1", (campaign_id,)
    ).fetchone() is not None


def write_templates(conn, campaign_id: int, blocks: list[dict]) -> None:
    with conn.transaction():
        for b in blocks:
            conn.execute(
                """INSERT INTO templates (campaign_id, block, subject, body)
                   VALUES (%s, %s, %s, %s)
                   ON CONFLICT (campaign_id, block) DO UPDATE
                     SET subject = EXCLUDED.subject, body = EXCLUDED.body""",
                (campaign_id, b["block"], b["subject"], b["body"]),
            )

"""Seed a tiny sandbox and run the RAG drafting loop offline — no Gmail, no LLM.

Applies schema_additions.sql, ensures a demo campaign + a couple of 'unsure' leads + a
knowledge doc exist, then runs the pipeline in dry / --no-llm mode with injected threads
so the full select → thread → analyze(stub) → parse → plan path is exercised end-to-end.

    python seed_unsure_demo.py        # dry-run plan over canned threads (writes nothing)

Needs DATABASE_URL in rag/.env. Safe: dry-run only — no drafts, no DB writes.
"""
from __future__ import annotations

from pathlib import Path

from rag import db
from rag.pipeline import RunOptions, run
from rag.settings import PACKAGE_ROOT, load_settings


def _ensure_demo(conn) -> int:
    # schema
    conn.execute((PACKAGE_ROOT / "schema_additions.sql").read_text())
    # knowledge doc
    with conn.transaction():
        conn.execute(
            """INSERT INTO knowledge_docs (name, content)
               VALUES ('Evertrust_Knowledge_Base', %s)
               ON CONFLICT (name) DO NOTHING""",
            ("EVERTRUST GmbH is a German construction and engineering firm. "
             "We deliver turnkey industrial projects across the EU.",),
        )
        # demo campaign
        row = conn.execute(
            """INSERT INTO campaigns (name, active, sender)
               VALUES ('RAG Demo Campaign', true, 'info')
               RETURNING id""",
        ).fetchone()
        campaign_id = row["id"]
        # two unsure leads, one routed to hanna
        conn.execute(
            """INSERT INTO leads (campaign_id, company_name, email, status, country, send_from)
               VALUES (%s, 'Asseco Poland', 'info@asseco.pl', 'unsure', 'Poland', ''),
                      (%s, 'DAGMA Sp', 'contact@dagma.eu', 'unsure', 'Poland', 'hanna')""",
            (campaign_id, campaign_id),
        )
    return campaign_id


def _canned_threads() -> dict:
    def msg(thread_id, mid, frm, subject, body, ts):
        import base64
        return {
            "id": mid, "threadId": thread_id, "internalDate": str(ts),
            "snippet": body,
            "payload": {
                "headers": [
                    {"name": "From", "value": frm},
                    {"name": "Subject", "value": subject},
                    {"name": "Date", "value": "Mon, 09 Jun 2026 10:00:00 +0200"},
                ],
                "body": {"data": base64.urlsafe_b64encode(body.encode()).decode()},
            },
        }
    return {
        "info@asseco.pl": [
            msg("ta", "ma1", "Evertrust <info@evertrust-germany.de>", "Partnership",
                "We would love to work with you.", 1000),
            msg("ta", "ma2", "Asseco <info@asseco.pl>", "Re: Partnership",
                "Not sure about your pricing model — can you clarify?", 2000),
        ],
        "contact@dagma.eu": [
            msg("td", "md1", "Hanna <hanna@evertrust-germany.de>", "Partnership",
                "Following up on our proposal.", 1000),
            msg("td", "md2", "DAGMA <contact@dagma.eu>", "Re: Partnership",
                "We are hesitant — what is your track record?", 2000),
        ],
    }


def main() -> None:
    settings = load_settings()
    conn = db.connect(settings.database_url)
    campaign_id = _ensure_demo(conn)
    conn.close()
    run(settings, RunOptions(
        live=False, use_llm=False, campaign_id=campaign_id, threads=_canned_threads(),
    ))


if __name__ == "__main__":
    main()

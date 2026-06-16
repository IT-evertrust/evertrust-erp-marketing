"""Seed an isolated test database with one demo campaign that exercises EVERY branch
of the decision matrix. Safe to run repeatedly (wipes and re-creates demo data only).

    python seed_demo.py            # uses DATABASE_URL from .env / environment
"""
from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import psycopg

from bazooka.settings import load_settings

TODAY = date.today()


def main() -> None:
    settings = load_settings()
    conn = psycopg.connect(settings.database_url)
    conn.execute(Path(__file__).with_name("schema.sql").read_text())

    with conn.transaction():
        # wipe previous demo data (FK order)
        conn.execute(
            "DELETE FROM send_log WHERE campaign_id IN (SELECT id FROM campaigns WHERE name = 'DEMO PL CYBERSECURITY')"
        )
        for table in ("leads", "templates", "news_intel"):
            conn.execute(
                f"DELETE FROM {table} WHERE campaign_id IN (SELECT id FROM campaigns WHERE name = 'DEMO PL CYBERSECURITY')"
            )
        conn.execute("DELETE FROM campaigns WHERE name = 'DEMO PL CYBERSECURITY'")

        campaign_id = conn.execute(
            """INSERT INTO campaigns (name, active, niche, target, country, region, project, sender)
               VALUES ('DEMO PL CYBERSECURITY', true, 'cybersecurity', 'solution', 'Poland',
                       'Anywhere', 'PLCybersec202676', 'hanna')
               RETURNING id"""
        ).fetchone()[0]

        leads = [
            # (company, type, email, status, date_sent) — one per decision branch
            ("Asseco Poland S.A.", "service provider", "info@asseco.pl", "", None),  # -> cold
            ("DAGMA Bezpieczeństwo IT", "service provider", "contact@dagma.eu",
             "Cold Outreached", TODAY - timedelta(days=3)),                          # -> followup
            ("Spyrosoft Solutions SA", "service provider", "office@spyro-soft.com",
             "Followed Up", TODAY - timedelta(days=5)),                              # -> finalpush
            ("Cybernat", "service provider", "michal@cybernat.pl",
             "Cold Outreached", TODAY - timedelta(days=1)),                          # -> skip NOT_DUE
            ("eSEC", "service provider", "info@esec.pl",
             "Final Push", TODAY - timedelta(days=2)),                               # -> skip (terminal)
            ("Lemlock", "service provider", "", "", None),                           # -> skip INVALID_EMAIL
            # U+2011 non-breaking hyphen — the real Gmail-rejection bug; hygiene must fix it
            ("DM-SYSTEM", "service provider", "biuro@dm‑system.pl", "", None),       # -> cold (cleaned)
        ]
        for company, ctype, email, status, sent in leads:
            conn.execute(
                """INSERT INTO leads (campaign_id, company_name, company_type, email, status, date_sent)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (campaign_id, company, ctype, email, status, sent),
            )

        templates = [
            ("COLD",
             "Partnership opportunity for {{Company Name}}",
             "Hello {{Company Name}} team,\n\nAs a {{Company Type}} in {{city}}, you may be "
             "interested in German public-tender opportunities in the {{project}} project.\n\n"
             "Best regards,\nEvertrust GmbH"),
            ("COLD-AGG",
             "{{Company Name}}: German tender demand is spiking",
             "Hello {{Company Name}} team,\n\nGiven recent developments, demand for "
             "{{Company Type}} capacity in German tenders is rising fast. We connect firms "
             "like yours to these tenders.\n\nBest regards,\nEvertrust GmbH"),
            ("FOLLOWUP",
             "Following up — {{Company Name}}",
             "Hello again,\n\nJust checking whether our note about German tender "
             "opportunities reached the right person at {{Company Name}}.\n\nBest,\nEvertrust"),
            ("FINALPUSH",
             "Last call — {{Company Name}}",
             "Hello,\n\nClosing the loop: if German public tenders are not relevant for "
             "{{Company Name}}, no reply needed and we will not write again.\n\nEvertrust"),
        ]
        for block, subject, body in templates:
            conn.execute(
                "INSERT INTO templates (campaign_id, block, subject, body) VALUES (%s, %s, %s, %s)",
                (campaign_id, block, subject, body),
            )

        conn.execute(
            """INSERT INTO news_intel (campaign_id, body, is_bad_news)
               VALUES (%s, %s, true)""",
            (campaign_id,
             "[BAD NEWS] isBadNews: true — Major ransomware wave hitting EU logistics; "
             "German municipalities fast-tracking cybersecurity tenders."),
        )

    conn.commit()
    conn.close()
    print("Seeded: campaign 'DEMO PL CYBERSECURITY' (7 leads, 4 template blocks, bad-news intel)")
    print("Expected dry-run: 2 cold (one via COLD-AGG), 1 followup, 1 finalpush, 3 skips")


if __name__ == "__main__":
    main()

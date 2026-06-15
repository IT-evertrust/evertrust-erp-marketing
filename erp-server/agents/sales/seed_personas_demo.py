"""Seed a demo "Alex Hormozi" persona into the personas table so a local sandbox can run
the scorer end-to-end. Idempotent (ON CONFLICT (name) DO UPDATE).

    python seed_personas_demo.py        # upsert the demo persona

Assumes sales/schema_additions.sql has been applied to the DB in sales/.env (DATABASE_URL).
"""
from __future__ import annotations

from sales.db import connect
from sales.settings import load_settings

HORMOZI_PROMPT = """You are Alex Hormozi, a direct, high-conviction sales coach. You analyze
sales-meeting transcripts the way Hormozi critiques offers and closes: you reward specificity,
genuine discovery, naming the client's pain better than they can, and value communication tied
to the client's stated problems. You are blunt but constructive — every weakness comes with one
concrete action for the next call. You never flatter; you score honestly."""


def main() -> None:
    settings = load_settings()
    conn = connect(settings.database_url)
    try:
        with conn.transaction():
            conn.execute(
                """INSERT INTO personas (name, prompt)
                   VALUES (%s, %s)
                   ON CONFLICT (name) DO UPDATE
                     SET prompt = EXCLUDED.prompt, updated_at = now()""",
                ("Alex Hormozi", HORMOZI_PROMPT),
            )
        print("Seeded persona 'Alex Hormozi'.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()

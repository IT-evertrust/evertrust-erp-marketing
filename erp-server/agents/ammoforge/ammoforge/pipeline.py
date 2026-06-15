"""Per-campaign: research demand-driver news -> write news_intel; if the campaign has no
templates, forge COLD/FOLLOWUP/FINALPUSH -> write templates. Dry-run default.

Both outputs feed Bazooka: news_intel.is_bad_news drives the COLD-AGG choice; templates
are what Bazooka sends.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import db
from .clients import llm
from .domain import news as news_domain
from .domain.templates import explode_blocks
from .settings import Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True
    campaign: str | None = None
    forge_templates: bool = True


def _lang(country: str) -> str:
    c = (country or "").lower()
    return "German" if any(k in c for k in ("de", "german", "deutsch")) else "English"


def run(settings: Settings, opts: RunOptions) -> dict:
    run_id = "forge-" + datetime.now().strftime("%Y-%m-%d-%H%M%S")
    today = datetime.now().strftime("%Y-%m-%d")
    report = [f"# Ammo Forge run {run_id} ({'live' if opts.live else 'dry'})", ""]
    summary = {"campaigns": 0, "bad_news": 0, "templates_forged": 0}

    def log(m: str) -> None:
        print(m, flush=True)
        report.append(f"- {m}")

    conn = db.connect(settings.database_url)
    campaigns = db.fetch_campaigns(conn, opts.campaign)
    if not campaigns:
        conn.close()
        raise SystemExit("No active campaigns to forge.")

    for c in campaigns:
        summary["campaigns"] += 1
        niche, city, country = c["niche"], c["region"], c["country"]
        lang = _lang(country)
        log(f"=== {c['name']} (niche={niche}, country={country}) ===")

        parsed = (llm.offline_news() if not opts.use_llm
                  else llm.research_news(settings, niche, city, country, lang))
        result = news_domain.build_news(parsed, project=c["project"], niche=niche, city=city,
                                        country=country, run_id=run_id, today=today)
        log(f"[news] items={result.item_count} bad={result.bad_count} "
            f"isBadNews={result.is_bad_news} (topSev={result.top_severity}, conf={result.confidence})")
        if result.is_bad_news:
            summary["bad_news"] += 1
        if opts.live:
            db.write_news_intel(conn, c["id"], result.body, result.is_bad_news)
            log("[news] written to news_intel")
        else:
            log("[news] (dry) would write news_intel")

        if opts.forge_templates:
            if db.has_templates(conn, c["id"]):
                log("[forge] templates already exist — skip (idempotent)")
            else:
                blocks = explode_blocks(niche)
                if opts.use_llm:
                    blocks = [llm.polish_block(settings, lang, b, niche, city, c["project"]) for b in blocks]
                log(f"[forge] {len(blocks)} blocks: " + ", ".join(b["block"] for b in blocks))
                if opts.live:
                    db.write_templates(conn, c["id"], blocks)
                    summary["templates_forged"] += 1
                    log("[forge] written to templates")
                else:
                    log("[forge] (dry) would write templates")

    conn.close()
    log(f"[summary] {summary}")
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(report) + "\n")
    print(f"Run report: {path}")
    print(f"Summary: {summary}")
    return summary

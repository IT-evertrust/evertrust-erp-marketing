"""The run loop: campaign -> profile -> plan -> search -> fetch -> extract -> validate
-> recover -> insert. Same five-beat agent shape as bazooka; the side effect here is
only a DB insert, but dry-run stays the default for symmetry — research runs are slow
and you want to eyeball the first fire plan of a new niche before committing rows.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from . import db, extract, geo, profiler, recovery, serp, sitefetch
from .plan import build_plan
from .settings import Settings
from .validate import merge_validate


@dataclass(frozen=True)
class RunOptions:
    campaign: str
    live: bool = False          # actually insert leads
    force: bool = False         # hunt even if the campaign already has leads
    use_llm: bool = True        # False => offline extraction (testing only)
    queries_per_city: int = 2
    max_queries: int = 600
    max_candidates: int = 1000
    max_cities: int = 0
    extract_batch_size: int = 8


def run(settings: Settings, opts: RunOptions) -> dict:
    run_id = "sat-" + datetime.now().strftime("%Y-%m-%d-%H%M%S")
    report_lines: list[str] = [f"# Satellite run {run_id} ({'live' if opts.live else 'dry'})", ""]

    def log(msg: str) -> None:
        print(msg, flush=True)
        report_lines.append(f"- {msg}")

    conn = db.connect(settings.database_url)
    campaign = db.fetch_campaign(conn, opts.campaign)
    if campaign is None:
        raise SystemExit(f"No active campaign named {opts.campaign!r}.")

    # skip-if-exists guard (was: Drive search for a 'leads*' file)
    existing = db.campaign_has_leads(conn, campaign["id"])
    if existing and not opts.force:
        log(f"SKIP_HAS_LEADS: campaign already has {existing} leads (use --force to re-hunt)")
        conn.close()
        return {"skipped": True, "existing": existing}
    if existing:
        log(f"FORCE_REHUNT: {existing} existing leads kept; new domains will be appended")

    # profiler: required for non-PL/DE; keyword top-up otherwise (skipped without LLM)
    cc = geo.resolve_builtin(campaign["country"])
    prof = None
    if opts.use_llm and settings.llm_base_url:
        prof = profiler.profile_country(settings, campaign["country"], campaign["niche"], log)
    elif not cc:
        raise SystemExit(
            f"V2 PROFILE ERROR: country '{campaign['country']}' is not built-in (PL/DE) "
            "and the profiler needs the LLM (--no-llm not possible here)"
        )

    plan = build_plan(
        niche=campaign["niche"],
        country=campaign["country"],
        region=campaign["region"],
        profiler=prof,
        searxng_url=settings.searxng_url,
        queries_per_city=opts.queries_per_city,
        max_queries=opts.max_queries,
        max_cities=opts.max_cities,
    )
    log(f"[V2 Plan] {len(plan.queries)} queries | {len(plan.cities)} cities | "
        f"{len(plan.keywords)} keywords | engines={plan.engines} | kl={plan.ddg_kl}")

    cands = serp.collect_candidates(settings, plan, log)
    gated = serp.gate_candidates(cands, opts.max_candidates, log)
    prepped = sitefetch.prep_candidates(gated, settings, log)

    by_id = {c.id: c for c in gated}
    companies: list[dict] = []
    parsed_chunks = failed_chunks = 0
    for chunk in extract.chunked(prepped, opts.extract_batch_size):
        if opts.use_llm:
            result = extract.extract_chunk(settings, chunk, plan.niche, plan.country_name)
        else:
            result = extract.offline_extract(chunk)
        if result is None:
            failed_chunks += 1
        else:
            parsed_chunks += 1
            companies.extend(result)
    log(f"[V2 Chunk] {parsed_chunks} chunks parsed, {failed_chunks} failed, "
        f"{len(companies)} companies returned")

    rows, stats = merge_validate(
        companies, by_id, parsed_chunks=parsed_chunks, failed_chunks=failed_chunks, log=log
    )

    recovery.recover_missing_emails(rows, plan, settings, log)

    with_email = sum(1 for r in rows if r.email)
    tiers: dict[str, int] = {}
    for r in rows:
        tiers[r.tier or "-"] = tiers.get(r.tier or "-", 0) + 1
    summary = {
        "ok": True, "project": campaign["project"], "niche": plan.niche,
        "country": plan.country_name, "leads": len(rows), "withEmail": with_email,
        "emailCoveragePct": round(100 * with_email / len(rows)) if rows else 0,
        "tiers": tiers, "runId": run_id,
    }
    log(f"[V2 Summary] {summary}")

    if opts.live:
        inserted = db.insert_leads(conn, campaign["id"], rows)
        log(f"INSERTED {inserted} leads into campaign {campaign['name']!r}")
        summary["inserted"] = inserted
    else:
        log(f"DRY RUN — {len(rows)} leads NOT inserted (use --live to commit)")
    conn.close()

    report_lines += ["", "## Leads", "",
                     "| Company | Type | Email | Status | Tier | City | Website |",
                     "|---|---|---|---|---|---|---|"]
    for r in rows:
        report_lines.append(
            f"| {r.company_name} | {r.company_type} | {r.email} | {r.status} "
            f"| {r.tier} | {r.city} | {r.website} |"
        )
    report_path = Path(settings.report_dir) / f"{run_id}.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(report_lines) + "\n")
    print(f"Run report: {report_path}")
    return summary

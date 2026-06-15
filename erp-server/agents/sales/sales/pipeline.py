"""Score one sales-meeting transcript: adapt -> validate -> resolve persona -> build
system message -> LLM (or offline) -> parse -> render -> persist (or plan-only).

Dry-run by default: writes nothing unless opts.live. --no-llm uses the deterministic offline
stub. Fixes baked in:
  - persona resolution surfaces fallback_first loudly (no silent mis-scoring)
  - parse failure -> error_log + return error result, never crash, never write a row
  - clean meeting_analyses column set
  - source routing: source=='erp' returns the analysis JSON only (no persist); else persist.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from . import db, readai
from .clients import llm
from .domain import render
from .domain.parse import ParseError, parse_analysis_json
from .domain.rubric import build_system_message
from .domain.transcript import validate_transcript
from .settings import Settings


@dataclass(frozen=True)
class RunOptions:
    live: bool = False
    use_llm: bool = True


def score(settings: Settings, opts: RunOptions, body: dict, today: date | None = None) -> dict:
    today = today or datetime.now().date()
    today_str = today.strftime("%Y-%m-%d")
    report: list[str] = []

    def log(m: str) -> None:
        print(m, flush=True)
        report.append(f"- {m}")

    # 1. adapt Read.ai/ERP webhook body -> chatInput + persona + source
    adapted = readai.adapt(body)
    if adapted.get("_readai_error"):
        log(f"[adapt] missing transcript: {adapted['_readai_error']}")
    source = adapted["source"]

    # 2. validate
    v = validate_transcript(adapted["chatInput"], adapted["active_persona_name"], source)
    if not v.valid:
        log(f"[validate] INVALID — {v.reason} (no write)")
        _write_report(settings, source, report)
        return {"valid": False, "error": v.reason, "detail": v.stats, "source": source}
    log(f"[validate] ok — words={v.stats['wordCount']} turns={v.stats['turns']} "
        f"primaryShare={v.stats['primaryShare']:.2f} flags={v.flags or 'none'}")

    # A DB connection is opened only when we need one (live, or any DB-backed lookup).
    # Kept open across persona-resolution + persist so a single autocommit connection
    # serves the whole run; closed in the finally below.
    conn = None
    need_db = opts.live or opts.use_llm
    if need_db:
        conn = db.connect(settings.database_url)
    try:
        return _score_with_conn(settings, opts, body, today_str, adapted, source, v,
                                conn, log, report)
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _score_with_conn(settings, opts, body, today_str, adapted, source, v, conn, log, report):
    # 3. resolve persona (DB) — fail loud on fallback_first, never silently mis-score
    persona_name = v.active_persona_name or "Alex Hormozi"
    persona_prompt = ""
    if conn is not None:
        match = db.resolve_persona(conn, persona_name)
        if match is None:
            log("[persona] ERROR — no persona docs found in personas table")
            return {"valid": False, "error": "no_personas", "source": source}
        persona_name = match.persona_name
        persona_prompt = match.prompt
        if match.match_type == "fallback_first":
            log(f"[persona] WARNING — requested {match.requested_persona!r} had no exact/"
                f"substring match; FELL BACK to first persona {persona_name!r} "
                f"(match_type=fallback_first). Scoring may be under the wrong persona.")
        else:
            log(f"[persona] resolved {match.requested_persona!r} -> {persona_name!r} "
                f"(match_type={match.match_type})")
    else:
        log("[persona] (offline) no DB lookup; using requested name + offline stub")

    # 4. build system message (persona prompt + VERBATIM Hormozi rubric + strict format)
    system = build_system_message(persona_prompt)

    # 5. LLM (or offline stub)
    if opts.use_llm:
        raw = llm.sales_coach(settings, system, v.agent_input)
        log("[llm] sales_coach pass complete")
    else:
        raw = llm.offline_coach(v.transcript)
        log("[llm] (offline) deterministic stub analysis")

    # 6. parse defensively — on failure: error_log + return error, no crash, no row
    try:
        analysis = parse_analysis_json(raw)
    except ParseError as e:
        log(f"[parse] FAILED — {e}; recording to error_log, skipping write")
        if opts.live and conn is not None:
            db.log_error(conn, source, "", "parse_analysis_json", str(e))
        _write_report(settings, source, report)
        return {"valid": True, "parsed": False, "error": "parse_failed",
                "detail": str(e), "source": source}

    # 7. render the clean row + report
    stats = {**v.stats, "transcript": v.transcript, "source": source}
    row = render.build_row(analysis, stats, persona_name, today_str)
    report_html = render.build_report(analysis, row, persona_name, v.flags, v.stats)
    log(f"[render] row: client={row.client_name!r} ae={row.ae_name!r} "
        f"perf={row.performance_score} client_score={row.client_score}")

    result = {"valid": True, "parsed": True, "source": source,
              "analysis": analysis, "row": row.as_dict()}

    # 8. source routing: erp -> return JSON only; else -> persist (when live)
    if source == "erp":
        log("[route] source=='erp' -> return analysis JSON only, no persist")
    elif opts.live:
        generated_at = datetime.now()
        new_id = db.insert_meeting_analysis(conn, row.as_dict(), v.transcript,
                                            report_html, generated_at)
        log(f"[persist] meeting_analyses row inserted id={new_id}")
        result["meeting_analysis_id"] = new_id
    else:
        log("[persist] (dry) would insert meeting_analyses row")

    _write_report(settings, source, report)
    return result


def _write_report(settings: Settings, source: str, lines: list[str]) -> None:
    run_id = "sa-" + datetime.now().strftime("%Y-%m-%d-%H%M%S") + "-" + (source or "x")[:12]
    path = Path(settings.report_dir) / f"{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"# Sales Agent {run_id}\n\n" + "\n".join(lines) + "\n")
    print(f"Run report: {path}")

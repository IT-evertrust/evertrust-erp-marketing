"""Sales Agent core — the function the ERP route calls: run(settings, opts, erp, llm) -> dict.

Faithful to n8n workflow OUNbboRQNqch5USk (SALES AGENT (PG)): validate transcript -> GET
/personas + resolve persona -> Hormozi-lens coach (LLM, strict JSON) -> parse. Then route by
source: 'erp' returns the analysis JSON only; otherwise render a report + POST /meeting-analyses.

Dry-run (default): analyze, but do NOT persist. --live persists (for non-erp sources).
Reuses the existing transcript/rubric/parse/render/llm modules; only the data layer is the ERP.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from .clients import llm as llm_default
from .clients.erp import ErpGateway
from .domain import parse, render, rubric, transcript


@dataclass(frozen=True)
class RunOptions:
    transcript: str = ""          # transcript text (chatInput)
    persona: str = "Alex Hormozi"
    source: str = "erp"           # 'erp' (return JSON) | 'readai' | 'manual' (persist)
    live: bool = False
    use_llm: bool = True


def _resolve_persona(personas: list[dict], target_name: str) -> tuple[str, str]:
    """Port of 'Resolve Persona': exact -> substring -> first. Returns (prompt, name)."""
    def norm(s):
        return str(s or "").lower().strip()

    target = norm(target_name)
    match = next((p for p in personas if norm(p.get("name") or p.get("persona_name")) == target), None)
    if not match:
        match = next((p for p in personas if target and target in norm(p.get("name") or p.get("persona_name"))), None)
    if not match and personas:
        match = personas[0]
    if not match:
        raise ValueError("No personas returned from ERP /personas")
    prompt = match.get("prompt") or match.get("body") or match.get("text") or ""
    return prompt, (match.get("name") or match.get("persona_name") or target_name)


def run(settings, opts: RunOptions, erp: ErpGateway, llm=llm_default) -> dict:
    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
    result: dict = {"runId": run_id, "mode": "live" if opts.live else "dry", "source": opts.source}

    val = transcript.validate_transcript(opts.transcript, opts.persona, opts.source)
    if not val.valid:
        return {**result, "status": "invalid", "valid": False, "reason": val.reason}

    personas = erp.get_personas()
    persona_prompt, persona_name = _resolve_persona(personas, val.active_persona_name or opts.persona)
    system = rubric.build_system_message(persona_prompt)

    raw = (llm.sales_coach(settings, system, val.agent_input) if opts.use_llm
           else llm.offline_coach(val.transcript))
    try:
        analysis = parse.parse_analysis_json(raw)
    except parse.ParseError as exc:
        return {**result, "status": "error", "reason": str(exc)}

    result["persona"] = persona_name
    result["status"] = "ok"

    # ERP-source callers want the raw analysis JSON, no persistence.
    if opts.source == "erp":
        return {**result, "analysis": analysis, "persisted": False}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stats = {**(val.stats or {}), "transcript": val.transcript, "source": val.source}
    row = render.build_row(analysis, stats, persona_name, today)
    report = render.build_report(analysis, row, persona_name, val.flags, val.stats or {})

    row_dict = asdict(row)
    row_dict.update({"report_html": report, "transcript": val.transcript,
                     "persona": persona_name, "generated_at": datetime.now(timezone.utc).isoformat()})

    result["persisted"] = False
    if opts.live:
        erp.save_meeting_analysis(row_dict)
        result["persisted"] = True
    result["row"] = {"client_name": row.client_name, "performance_score": row.performance_score,
                     "client_score": row.client_score, "summary": row.summary}
    return result

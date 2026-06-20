"""Pure Sales-Agent helpers — verbatim ports of the standalone agent's domain functions:
transcript validation/adaptation (§6.1/6.2/6.5), the defensive analysis parser (§6.8), and
the row/report renderers (§6.9/6.10). No I/O, no LLM — all gateway/persistence lives in the ERP.
"""
from __future__ import annotations

import json
import math
import re

from erp_agents.workflows.activate.sales_agent.models import AnalysisRow, ValidationResult

# ---- transcript validation (§6.1) ----
# Matches a speaker turn line. Accepts an optional [mm:ss] timestamp and an optional pair
# of brackets around the speaker name — Read AI's native transcript `.text` uses the
# bracketed form ("[Hanna Gia Nguyen]: ...") while the webhook adapter (adapt_readai) emits
# "[mm:ss] Name: ...". Both must gate through.
_TURN_RE = re.compile(r"^(?:\[\d{2}:\d{2}\]\s*)?\[?([A-Za-z][^:\]]{0,60})\]?:\s")
LOW_ENGAGEMENT_CONTEXT = (
    "[CONTEXT: minimal client engagement <5%. buying_intent and interest MUST be below 20.]\n\n"
)


def validate_transcript(
    chat_input, active_persona_name: str = "", source: str = ""
) -> ValidationResult:
    """Gate a normalized transcript before scoring (≥100 words, ≥4 turns, salesperson speaks)."""
    if not chat_input or not isinstance(chat_input, str):
        return ValidationResult(valid=False, reason="empty_input")

    transcript = chat_input.strip()
    words = [w for w in re.split(r"\s+", transcript) if w]
    word_count = len(words)

    turns: list[dict] = []
    speakers: dict[str, dict] = {}
    for line in transcript.split("\n"):
        m = _TURN_RE.match(line)
        if not m:
            if turns:
                extra = len([w for w in re.split(r"\s+", line) if w])
                turns[-1]["words"] += extra
                speakers[turns[-1]["speaker"]]["words"] += extra
            continue
        name = m.group(1).strip()
        rest = line[m.end():]
        wc = len([w for w in re.split(r"\s+", rest) if w])
        turns.append({"speaker": name, "words": wc})
        s = speakers.setdefault(name, {"turns": 0, "words": 0})
        s["turns"] += 1
        s["words"] += wc

    distinct_speakers = list(speakers.keys())
    total_speaker_words = sum(s["words"] for s in speakers.values()) or 1
    primary_speaker = distinct_speakers[0] if distinct_speakers else ""
    primary_words = speakers.get(primary_speaker, {}).get("words", 0)
    primary_share = primary_words / total_speaker_words
    other_share = 1.0 - primary_share

    stats = {
        "wordCount": word_count,
        "turns": len(turns),
        "distinctSpeakers": len(distinct_speakers),
        "primaryShare": primary_share,
        "otherShare": other_share,
    }

    if word_count < 100:
        return ValidationResult(valid=False, reason="transcript_too_short", stats=stats)
    if len(turns) < 4:
        return ValidationResult(valid=False, reason="too_few_speaker_turns", stats=stats)
    if primary_share < 0.05:
        return ValidationResult(valid=False, reason="no_salesperson_speech", stats=stats)

    flags: list[str] = []
    if other_share < 0.05:
        flags.append("low_client_engagement")

    agent_input = transcript
    if "low_client_engagement" in flags:
        agent_input = LOW_ENGAGEMENT_CONTEXT + transcript

    return ValidationResult(
        valid=True,
        transcript=transcript,
        agent_input=agent_input,
        flags=flags,
        active_persona_name=active_persona_name,
        source=source,
        stats=stats,
    )


def adapt_readai(body: dict) -> dict:
    """Read.ai webhook body -> {chatInput} with [mm:ss] timestamps + optional context block (§6.2)."""
    body = body or {}
    blocks = (body.get("transcript") or {}).get("speaker_blocks")
    if not isinstance(blocks, list):
        return {"chatInput": "", "_readai_error": "missing_transcript"}

    summary = body.get("summary")
    chapters = body.get("chapter_summaries") or []
    topics = body.get("topics") or []
    context_block = ""
    if summary or chapters or topics:
        ctx = ["========== READ.AI CONTEXT (supporting, not primary) =========="]
        if summary:
            ctx.append("# Meeting Summary")
            ctx.append(str(summary))
        if chapters:
            ctx.append("# Chapter Summaries")
            for i, c in enumerate(chapters, start=1):
                ctx.append(f"{i}. {c.get('title', '')}")
                desc = c.get("description", "")
                if desc:
                    ctx.append(f"   {desc}")
        if topics:
            ctx.append("# Topics")
            for t in topics:
                text = t.get("text", "") if isinstance(t, dict) else str(t)
                ctx.append(f"- {text}")
        ctx.append("")
        ctx.append("========== TRANSCRIPT (primary) ==========")
        context_block = "\n".join(ctx) + "\n"

    segment_start_ms = (blocks[0].get("start_time") if blocks else 0) or 0
    lines = []
    for b in blocks:
        name = (b.get("speaker") or {}).get("name") or "Unknown"
        text = b.get("words", "") or ""
        start = b.get("start_time", 0) or 0
        offset_sec = max(0, math.floor((start - segment_start_ms) / 1000))
        mm = offset_sec // 60
        ss = offset_sec % 60
        lines.append(f"[{mm:02d}:{ss:02d}] {name}: {text}")
    return {"chatInput": context_block + "\n".join(lines)}


# ---- defensive analysis parser (§6.8) ----
_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")
_REQUIRED = ["overall_summary", "sales_technique_analysis", "performance_score", "client_analysis"]


class ParseError(Exception):
    """Raised on any parse failure — the workflow records it and returns status=error."""


def parse_analysis_json(text):
    """Return the parsed analysis dict. Raises ParseError on any failure."""
    if text and isinstance(text, (dict, list)):
        parsed = text if isinstance(text, dict) else {"output": text}
    else:
        cleaned = str(text or "").strip()
        fence = _FENCE_RE.search(cleaned)
        if fence:
            cleaned = fence.group(1).strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ParseError("Agent returned no JSON object")
        cleaned = cleaned[start:end + 1]
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as e:
            raise ParseError(f"Agent JSON failed to parse: {e}")

    if isinstance(parsed, dict) and isinstance(parsed.get("output"), dict):
        parsed = parsed["output"]

    missing = [k for k in _REQUIRED if k not in parsed]
    if missing:
        raise ParseError(f"Agent JSON missing required keys: {missing}")
    return parsed


# ---- row + report rendering (§6.9 / §6.10) ----
_SPEAKER_RE = re.compile(r"^(?:\[\d{2}:\d{2}\]\s*)?\[?([A-Z][a-zA-Z0-9_\-\s]{0,30})\]?:")
_DIMS = ["rapport_building", "discovery_quality", "pain_discovery", "value_communication"]


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return round(f)


def _score(section, key):
    sub = (section or {}).get(key) or {}
    return _num(sub.get("score"))


def _derive_speakers(transcript: str) -> tuple[str, str]:
    seen: list[str] = []
    for line in (transcript or "").split("\n"):
        m = _SPEAKER_RE.match(line)
        if not m:
            continue
        name = m.group(1).strip()
        if name and name not in seen:
            seen.append(name)
        if len(seen) >= 2:
            break
    first = seen[0] if seen else ""
    second = seen[1] if len(seen) > 1 else ""
    return first, second


def _flatten_strengths(items) -> str:
    out = []
    for i, s in enumerate(items or [], start=1):
        meth = s.get("methodology") or {}
        out.append(
            f"{i}. {s.get('moment', '')} [{s.get('timestamp', '')}] — "
            f"{s.get('why_effective', '')} "
            f"({meth.get('source', '')}: {meth.get('pattern', '')})"
        )
    return "\n".join(out)


def _flatten_weaknesses(items) -> str:
    out = []
    for i, w in enumerate(items or [], start=1):
        meth = w.get("methodology") or {}
        out.append(
            f"{i}. {w.get('area', '')} [{w.get('timestamp', '')}] — "
            f"{w.get('observation', '')} | quote: {w.get('evidence_quote', '')} | "
            f"fix: {w.get('suggestion', '')} ({meth.get('source', '')}: {meth.get('pattern', '')})"
        )
    return "\n".join(out)


def build_row(analysis: dict, transcript_stats: dict, persona_name: str, today: str) -> AnalysisRow:
    """Map a parsed analysis to the flattened meeting_analyses row. Derives ae/contact from the
    first/second speakers when the model omits them."""
    transcript = (transcript_stats or {}).get("transcript", "")
    first_speaker, second_speaker = _derive_speakers(transcript)

    ae_name = analysis.get("ae_name") or first_speaker
    client_contact = analysis.get("client_contact") or second_speaker
    client_company = analysis.get("client_company") or "Unknown"

    perf = analysis.get("performance_score") or {}
    client = analysis.get("client_analysis") or {}

    return AnalysisRow(
        client_name=client_company,
        ae_name=ae_name or "",
        meeting_date=today,
        summary=analysis.get("overall_summary", ""),
        strengths=_flatten_strengths(analysis.get("strengths")),
        weaknesses=_flatten_weaknesses(analysis.get("weaknesses")),
        performance_score=_score(perf, "overall"),
        understanding_client_needs=_score(perf, "understanding_client_needs"),
        communication=_score(perf, "communication"),
        technical_explanation=_score(perf, "technical_explanation"),
        aggressiveness=_score(perf, "aggressiveness"),
        client_score=_score(client, "overall"),
        client_buying_intent=_score(client, "buying_intent"),
        client_interest=_score(client, "interest"),
        client_communication=_score(client, "communication"),
        persona=persona_name or "Alex Hormozi",
        source=(transcript_stats or {}).get("source", "") or "",
    )


def build_report(analysis: dict, row: AnalysisRow, persona_name: str, flags: list[str], stats: dict) -> str:
    """A simple markdown report (Postgres-side equivalent of the §6.9 report HTML)."""
    client = analysis.get("client_analysis") or {}  # noqa: F841 (kept for parity)
    tech = analysis.get("sales_technique_analysis") or {}
    lines = [
        f"# Sales Coach Report — {persona_name} Lens",
        "",
        "## Basic Overview",
        f"- Persona: {persona_name}",
        f"- AE: {row.ae_name}",
        f"- Client Contact: {analysis.get('client_contact', '')}",
        f"- Client Company: {row.client_name}",
        f"- Word Count: {(stats or {}).get('wordCount', '')}",
        f"- Flags: {', '.join(flags) if flags else 'none'}",
        "",
        "## Executive Summary",
        analysis.get("overall_summary", ""),
        "",
        "## Sales Technique Analysis",
    ]
    for dim in _DIMS:
        d = tech.get(dim) or {}
        lines.append(f"### {dim} — {d.get('score', '')}/10")
        for q in d.get("quotes") or []:
            lines.append(f"- \"{q.get('text', '')}\" [{q.get('timestamp', '')}]")
        rec = d.get("improvement_recommendation", "")
        if rec:
            lines.append(f"- Recommendation: {rec}")
    lines += [
        "",
        "## Performance",
        f"- Overall: {row.performance_score}/100",
        f"- Understanding Client Needs: {row.understanding_client_needs}/100",
        f"- Communication: {row.communication}/100",
        f"- Technical Explanation: {row.technical_explanation}/100",
        f"- Aggressiveness: {row.aggressiveness}/100",
        "",
        "## Client Analysis",
        f"- Overall: {row.client_score}/100",
        f"- Buying Intent: {row.client_buying_intent}/100",
        f"- Interest: {row.client_interest}/100",
        f"- Communication: {row.client_communication}/100",
        "",
        "## What Worked",
        row.strengths or "(none)",
        "",
        "## What to Improve",
        row.weaknesses or "(none)",
    ]
    return "\n".join(lines)


# ---- offline coach (dev fallback when the LLM gateway is unreachable) ----
def offline_coach(persona_name: str = "Alex Hormozi") -> dict:
    """A VALID strict-schema analysis dict so the parser + render path runs with no gateway."""
    def dim(score, ts, rec):
        return {
            "score": score,
            "quotes": [{"text": "(offline stub quote)", "timestamp": ts}],
            "improvement_recommendation": rec,
        }

    return {
        "overall_summary": "(offline stub) Sales call analyzed without the LLM gateway.",
        "client_company": "Unknown",
        "ae_name": "",
        "client_contact": "",
        "sales_technique_analysis": {
            "rapport_building": dim(6, "00:30", "Open with a warmer personal check-in."),
            "discovery_quality": dim(5, "03:15", "Ask more open-ended diagnostic questions."),
            "pain_discovery": dim(5, "07:22", "Quantify the cost of inaction before pitching."),
            "value_communication": dim(6, "12:45", "Tie the offer to the client's stated problems."),
        },
        "strengths": [
            {
                "moment": "Clear next steps",
                "timestamp": "05:42",
                "why_effective": "Reduced ambiguity for the client.",
                "methodology": {"source": "Hormozi", "pattern": "Risk Reversal"},
            }
        ],
        "weaknesses": [
            {
                "area": "Discovery",
                "timestamp": "12:08",
                "observation": "Pitched before diagnosing.",
                "evidence_quote": "(offline stub quote)",
                "suggestion": "Diagnose before prescribing.",
                "methodology": {"source": "Hormozi", "pattern": "Name the Objection"},
            }
        ],
        "performance_score": {
            "overall": {"score": 60, "rationale": "(offline stub)"},
            "understanding_client_needs": {"score": 55, "rationale": "(offline stub)"},
            "communication": {"score": 70, "rationale": "(offline stub)"},
            "technical_explanation": {"score": 65, "rationale": "(offline stub)"},
            "aggressiveness": {"score": 40, "rationale": "(offline stub)"},
        },
        "client_analysis": {
            "overall": {"score": 55, "rationale": "(offline stub)"},
            "buying_intent": {"score": 50, "rationale": "(offline stub)"},
            "interest": {"score": 60, "rationale": "(offline stub)"},
            "communication": {"score": 65, "rationale": "(offline stub)"},
        },
    }

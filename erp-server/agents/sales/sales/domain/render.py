"""Report + row rendering — port of n8n 'Render Doc Inputs' (§6.9) and 'Merge Doc Link'
(§6.10), reduced to the Postgres targets. Builds the clean meeting_analyses row (the §6.10
column set, ignoring the sheet's legacy duplicate columns) and a markdown report string.
Pure logic, no I/O."""
from __future__ import annotations

import re

from .models import AnalysisRow

# §6.9 speaker re-derivation regex (verbatim): first two distinct speakers.
_SPEAKER_RE = re.compile(r"^(?:\[\d{2}:\d{2}\]\s*)?([A-Z][a-zA-Z0-9_\-\s]{0,30}):")

_DIMS = ["rapport_building", "discovery_quality", "pain_discovery", "value_communication"]


def _num(v):
    """Coerce a score to a rounded int, or None if non-finite/absent."""
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
    """First two distinct speakers from the transcript (§6.9)."""
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
    """Map a parsed analysis to the clean meeting_analyses row (§6.10 column set).
    Derives ae_name/client_contact from the first/second speakers if absent (§6.9)."""
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
        persona=persona_name or "Hormozi",
        source=(transcript_stats or {}).get("source", "") or "",
    )


def build_report(analysis: dict, row: AnalysisRow, persona_name: str, flags: list[str], stats: dict) -> str:
    """A simple markdown report (the Postgres-side equivalent of the §6.9 report HTML)."""
    perf = analysis.get("performance_score") or {}
    client = analysis.get("client_analysis") or {}
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

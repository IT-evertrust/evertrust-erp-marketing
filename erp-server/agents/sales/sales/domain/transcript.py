"""Transcript adaptation + validation — verbatim ports of the n8n Code nodes:
  - validate_transcript()  §6.1  (the central gate)
  - adapt_readai()         §6.2  (Read.ai speaker_blocks -> timestamped chatInput)
  - flatten_erp()          §6.5  (ERP webhook speaker_blocks -> flat "Name: words")
Pure logic, no I/O.
"""
from __future__ import annotations

import math
import re

from .models import ValidationResult

# §6.1 speaker-turn regex (verbatim): optional [mm:ss] prefix, speaker name (starts alpha,
# up to 60 non-colon chars), colon, space.
_TURN_RE = re.compile(r"^(?:\[\d{2}:\d{2}\]\s*)?([A-Za-z][^:]{0,60}):\s")

# §6.1 verbatim low-engagement context line, prepended to agentInput.
LOW_ENGAGEMENT_CONTEXT = (
    "[CONTEXT: minimal client engagement <5%. buying_intent and interest MUST be below 20.]\n\n"
)


def validate_transcript(
    chat_input, active_persona_name: str = "", source: str = ""
) -> ValidationResult:
    """§6.1 verbatim. Gates a normalized transcript before scoring."""
    # If no / non-string text -> empty_input.
    if not chat_input or not isinstance(chat_input, str):
        return ValidationResult(valid=False, reason="empty_input")

    transcript = chat_input.strip()

    # word count = split on whitespace, filtered non-empty.
    words = [w for w in re.split(r"\s+", transcript) if w]
    word_count = len(words)

    # Speaker-turn parsing: accumulate words per turn; roll up per-speaker {turns, words}.
    turns: list[dict] = []
    speakers: dict[str, dict] = {}
    for line in transcript.split("\n"):
        m = _TURN_RE.match(line)
        if not m:
            # continuation of the current turn — count its words against that speaker
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

    # Gates (each returns valid:false).
    if word_count < 100:
        return ValidationResult(valid=False, reason="transcript_too_short", stats=stats)
    if len(turns) < 4:
        return ValidationResult(valid=False, reason="too_few_speaker_turns", stats=stats)
    if primary_share < 0.05:
        return ValidationResult(valid=False, reason="no_salesperson_speech", stats=stats)

    # Flags: low_client_engagement if otherShare < 0.05.
    flags: list[str] = []
    if other_share < 0.05:
        flags.append("low_client_engagement")

    # agentInput: trimmed transcript; if low_client_engagement, prepend the context line.
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
    """§6.2 verbatim. Read.ai webhook body -> {chatInput} with [mm:ss] timestamps and an
    optional Read.ai context block."""
    body = body or {}
    blocks = ((body.get("transcript") or {}).get("speaker_blocks"))
    if not isinstance(blocks, list):
        return {"chatInput": "", "_readai_error": "missing_transcript"}

    # Optional context block — only if summary / chapter_summaries / topics present.
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

    # Transcript build: offset from first block start_time, [mm:ss] Name: words.
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
    transcript_text = "\n".join(lines)

    return {"chatInput": context_block + transcript_text}


def flatten_erp(body: dict) -> dict:
    """§6.5 verbatim. ERP webhook body -> flat "Name: words\\n" chatInput (no timestamps),
    plus default persona + source 'readai' (matches the n8n quirk in §6.5 note)."""
    inner = (body or {}).get("body") or {}
    blocks = ((inner.get("transcript") or {}).get("speaker_blocks")) or []
    parts = []
    for b in blocks:
        name = (b.get("speaker") or {}).get("name") or ""
        text = b.get("words", "") or ""
        parts.append(f"{name}: {text}\n")
    text = "".join(parts)
    return {
        "chatInput": text.strip(),
        "active_persona_name": str(inner.get("persona") or "Alex Hormozi"),
        "source": "readai",
    }

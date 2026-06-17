"""Read.ai payload adapter — port of 'Adapt Meeting Text'. Flattens the webhook body into
one markdown blob the signal extractor reads, plus title + meeting id."""
from __future__ import annotations


def adapt(body: dict) -> dict:
    title = body.get("title", "") or ""
    parts = [f"Meeting title: {title}"]
    if body.get("summary"):
        parts.append(f"# Summary\n{body['summary']}")
    chapters = body.get("chapter_summaries") or []
    if chapters:
        lines = "\n".join(f"- {c.get('title','')}: {c.get('description','')}" for c in chapters)
        parts.append(f"# Chapters\n{lines}")
    blocks = ((body.get("transcript") or {}).get("speaker_blocks")) or []
    if blocks:
        lines = "\n".join(f"{b.get('speaker',{}).get('name','')}: {b.get('words','')}" for b in blocks)
        parts.append(f"# Transcript\n{lines}")
    return {
        "text": "\n".join(parts),
        "title": title,
        "meeting_id": body.get("session_id", "") or "",
    }

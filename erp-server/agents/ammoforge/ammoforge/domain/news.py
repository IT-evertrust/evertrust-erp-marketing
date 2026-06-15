"""News classification + is_bad_news + doc rendering — verbatim port of 'Build News Doc'.

This is the Bazooka contract. In Postgres, Bazooka reads the `news_intel.is_bad_news`
BOOLEAN column directly (cleaner than the n8n grep of /isBadNews:\\s*true/i), but we still
render the full readable body (with the [BAD NEWS ...] item labels) into `news_intel.body`,
because Bazooka feeds that text to the LLM as the COLD-AGG news-hook context.
"""
from __future__ import annotations

from dataclasses import dataclass

BAD_CATEGORIES = {
    "conflict", "war", "tension", "breach", "cyberattack", "attack", "hack", "sabotage",
    "disaster", "accident", "failure", "outage", "crisis", "shortage", "sanction", "ban",
    "fine", "recall",
}

BAD_SEVERITY_THRESHOLD = 0.6
BAD_CONFIDENCE_THRESHOLD = 0.4


@dataclass
class NewsResult:
    body: str
    is_bad_news: bool
    item_count: int
    bad_count: int
    top_severity: float
    confidence: float


def _classify(item: dict) -> str:
    sent = str(item.get("sentiment", "")).lower()
    if sent in ("bad", "good", "neutral"):
        return sent
    cat = str(item.get("category", "")).lower()
    sev = _num(item.get("severity"))
    return "bad" if (cat in BAD_CATEGORIES or sev >= 0.5) else "neutral"


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _flag(sent: str) -> str:
    return {"good": "GOOD NEWS", "bad": "BAD NEWS"}.get(sent, "NEUTRAL")


def build_news(parsed: dict, *, project: str, niche: str, city: str, country: str,
               run_id: str, today: str) -> NewsResult:
    raw = parsed.get("news") or []
    classified = []
    for n in raw:
        if not (n.get("headline") or n.get("title")):
            continue
        sent = _classify(n)
        classified.append({**n, "_sent": sent, "_sev": _num(n.get("severity"))})
        if len(classified) >= 10:
            break

    bad = sorted([n for n in classified if n["_sent"] == "bad"], key=lambda n: -n["_sev"])
    has_bad = len(bad) > 0
    top_sev = bad[0]["_sev"] if has_bad else 0.0
    confidence = (parsed["confidence"] if isinstance(parsed.get("confidence"), (int, float))
                  else 0.6) if classified else 0.0
    is_bad = has_bad and top_sev >= BAD_SEVERITY_THRESHOLD and confidence >= BAD_CONFIDENCE_THRESHOLD

    L = [
        f"NEWS INTEL — {project}",
        f"Niche: {niche} | Location: {city}, {country}",
        (f"Generated: {today} | runId: {run_id} | isBadNews: {str(is_bad).lower()} | "
         f"topSeverity: {top_sev} | confidence: {confidence} | items: {len(classified)} "
         f"(bad: {len(bad)})"),
        "",
    ]
    if not classified:
        L.append("⚠ NO NEWS FOUND for this niche/region.")
    else:
        for i, n in enumerate(classified):
            tag = _flag(n["_sent"])
            head = f"[{tag}"
            if n.get("category"):
                head += f" · {n['category']}"
            if n.get("severity") is not None:
                head += f" · sev {n.get('severity')}"
            head += f"] {n.get('headline') or n.get('title')}"
            L.append(f"{i + 1}) {head}")
            if n.get("summary"):
                L.append(f"   {n['summary']}")
            if n.get("whyItMatters"):
                L.append(f"   -> Why it matters for {niche}: {n['whyItMatters']}")
            if n.get("source") or n.get("date"):
                L.append(f"   {n.get('source','')} — {n.get('date','')}")
            if n.get("url"):
                L.append(f"   {n['url']}")
            L.append("")
    hooks = parsed.get("hooks") or []
    if hooks:
        L.append("SUGGESTED OUTREACH HOOKS (from BAD news)")
        L += [f"• {h}" for h in hooks]
        L.append("")
    elif classified and not has_bad:
        L.append("NOTE: no BAD-news hook → professional template only, no aggressive variant.")

    return NewsResult(body="\n".join(L), is_bad_news=is_bad, item_count=len(classified),
                      bad_count=len(bad), top_severity=top_sev, confidence=confidence)

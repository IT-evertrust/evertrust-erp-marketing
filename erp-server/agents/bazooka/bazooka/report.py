"""Run report — the dry-run deliverable and the live-run audit trail.

Replaces n8n's execution view: every lead's decision, every would-be/actual email, and
every WhatsApp message land in runs/<run_id>.md.
"""
from __future__ import annotations

from pathlib import Path


class RunReport:
    def __init__(self, report_dir: str, run_id: str, mode: str) -> None:
        self.path = Path(report_dir) / f"{run_id}.md"
        self.lines: list[str] = [f"# Bazooka run {run_id} ({mode})", ""]

    def section(self, title: str) -> None:
        self.lines += [f"## {title}", ""]

    def line(self, text: str = "") -> None:
        self.lines.append(text)

    def whatsapp(self, text: str, sent: bool) -> None:
        tag = "WA SENT" if sent else "WA (dry — not sent)"
        self.lines += [f"> **{tag}:**", *(f"> {l}" for l in text.splitlines()), ""]

    def email(self, to: str, sender: str, action: str, subject: str, body: str, sent: bool) -> None:
        tag = "EMAIL SENT" if sent else "EMAIL PLANNED (dry — not sent)"
        self.lines += [
            f"### {tag}: {to}",
            f"- action: `{action}` | from: `{sender}`",
            f"- subject: {subject}",
            "",
            "```",
            body,
            "```",
            "",
        ]

    def write(self) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("\n".join(self.lines) + "\n")
        return self.path

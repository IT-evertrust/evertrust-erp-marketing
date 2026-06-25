from datetime import datetime, timezone
from typing import Any

from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.activate.read_ai_sync.models import (
    ReadAiSyncInput,
    ReadAiSyncOutput,
)
from erp_agents.workflows.activate.sales_agent.tools import adapt_readai


def _first(d: dict, *keys: str) -> Any:
    """First truthy value among the candidate keys (Read.ai's exact field names
    aren't documented, so we probe the common variants)."""
    for k in keys:
        v = d.get(k)
        if v:
            return v
    return None


def _to_iso(value: Any) -> str | None:
    """Best-effort ISO-8601 from whatever Read.ai returns for a meeting time:
    an ISO string passes through; an epoch (s or ms) is converted; else None."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        secs = value / 1000 if value > 1e11 else value
        try:
            return datetime.fromtimestamp(secs, tz=timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    return None


def _to_item(summary_row: dict, detail: dict) -> dict:
    """Map a Read.ai meeting (list row + detail body) to the ERP's camelCase
    ReadAiImportItem. Transcript is built from speaker_blocks via adapt_readai."""
    detail = detail or {}
    transcript = (adapt_readai(detail) or {}).get("chatInput", "") or ""
    read_ai_id = _first(detail, "id", "session_id", "meeting_id") or _first(
        summary_row, "id", "session_id", "meeting_id"
    )
    title = _first(detail, "title", "subject", "meeting_title") or _first(
        summary_row, "title", "subject", "meeting_title"
    )
    meeting_date = _to_iso(
        _first(detail, "start_time", "start_timestamp", "start", "date", "created_at")
        or _first(summary_row, "start_time", "start_timestamp", "start", "date")
    )
    # Participants: try to surface an external contact + email (best-effort only).
    participants = _first(detail, "participants", "attendees") or []
    contact = None
    email = None
    if isinstance(participants, list) and participants:
        first = participants[0]
        if isinstance(first, dict):
            contact = _first(first, "name", "full_name", "display_name")
            email = _first(first, "email", "email_address")
        elif isinstance(first, str):
            email = first

    return {
        "readAiId": str(read_ai_id) if read_ai_id else None,
        "title": title,
        "company": _first(detail, "company", "organization"),
        "contact": contact,
        "email": email,
        "owner": _first(detail, "owner", "host", "organizer"),
        "meetingDate": meeting_date,
        "transcript": transcript or None,
        "summary": detail.get("summary"),
        "docUrl": _first(detail, "report_url", "url", "permalink", "doc_url"),
    }


class ReadAiSyncWorkflow(Workflow):
    """Pull recent Read.ai meetings + full transcripts and return them as ERP import
    items. The ERP calls this (manually or on a schedule), imports the items, then
    auto-analyzes any that gained a transcript. Side-effecting (HTTP) — no LLM.
    """

    name = "activate.read_ai_sync"

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(
                self.trace_step("validate_input", job.input, workflow_input.model_dump())
            )

            # Import here so a missing key/base-url surfaces as a clean "disabled"
            # result rather than an import-time crash.
            from erp_agents.clients.read_ai_client import ReadAiClient

            try:
                client = ReadAiClient()
            except ValueError as exc:
                output = ReadAiSyncOutput(status="disabled", reason=str(exc))
                trace.append(self.trace_step("client_init", None, {"disabled": str(exc)}))
                return AgentResult(
                    job_id=job.job_id,
                    workflow=self.name,
                    status="success",
                    output=output.model_dump(),
                    trace=trace,
                )

            rows = client.list_recent_meetings(limit=workflow_input.limit)
            # Log the shape so field mappings can be tuned against the live API.
            sample_keys = sorted(rows[0].keys()) if rows and isinstance(rows[0], dict) else []
            trace.append(
                self.trace_step("list_recent", {"limit": workflow_input.limit},
                                {"count": len(rows), "row_keys": sample_keys})
            )

            items: list[dict] = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                mid = _first(row, "id", "session_id", "meeting_id")
                if not mid:
                    continue
                try:
                    detail = client.get_meeting_analysis(str(mid))
                except Exception as exc:  # one bad meeting must not abort the sync
                    trace.append(self.trace_step("detail_error", {"id": str(mid)}, {"error": str(exc)}))
                    continue
                item = _to_item(row, detail if isinstance(detail, dict) else {})
                # Keep only rows the ERP can key on (ULID, or a title to slug a session key).
                if item.get("readAiId") or item.get("title"):
                    items.append(item)

            with_transcript = sum(1 for i in items if i.get("transcript"))
            output = ReadAiSyncOutput(status="ok", items=items, count=len(items))
            trace.append(
                self.trace_step("map_items", None,
                                {"items": len(items), "with_transcript": with_transcript})
            )
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={"meetings": len(items), "with_transcript": with_transcript},
                trace=trace,
            )
        except Exception as exc:
            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="failed",
                errors=[str(exc)],
                trace=trace,
            )

    def validate_input(self, payload: dict[str, Any]) -> ReadAiSyncInput:
        return ReadAiSyncInput.model_validate(payload or {})

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)

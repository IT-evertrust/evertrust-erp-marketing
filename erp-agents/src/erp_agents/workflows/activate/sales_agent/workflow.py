"""Activate Sales Agent — the after-sales call coach.

Faithful to n8n SALES AGENT (PG) OUNbboRQNqch5USk: validate transcript -> build the
persona-lens system message -> coach (LLM, strict JSON) -> parse. Brain-only: the ERP resolves
the persona from the PG `personas` table and passes its prompt in, then persists the analysis.

Output carries both the structured analysis (for the ERP to store on `meetings.analysis`) and a
flattened row + markdown report (for non-erp sources). Invalid transcripts return status=invalid
and are never scored; a parse failure returns status=error.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.activate.sales_agent.models import SalesAgentInput
from erp_agents.workflows.activate.sales_agent.prompts import build_system_message
from erp_agents.workflows.activate.sales_agent.tools import (
    ParseError,
    adapt_readai,
    build_report,
    build_row,
    offline_coach,
    parse_analysis_json,
    validate_transcript,
)


class SalesAgentWorkflow(Workflow):
    """Score a meeting transcript through a chosen sales-coach persona lens."""

    name = "activate.sales_agent"

    def __init__(self, llm: LlmClient | None = None) -> None:
        # Lazy: instantiate on first use so an unreachable gateway falls back to offline.
        self._llm = llm
        self._llm_attempted = llm is not None

    @property
    def llm(self) -> LlmClient | None:
        if self._llm is None and not self._llm_attempted:
            self._llm_attempted = True
            try:
                self._llm = LlmClient()
            except Exception:
                self._llm = None
        return self._llm

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        run_id = datetime.now(timezone.utc).strftime("%Y-%m-%d-%H%M")
        try:
            data = SalesAgentInput.model_validate(job.input)
            trace.append(self.trace_step("validate_input", job.input, data.model_dump()))

            # A raw Read.ai webhook body adapts to timestamped chatInput; otherwise flat text.
            chat_input = data.transcript
            if not chat_input and data.readai_body:
                chat_input = adapt_readai(data.readai_body).get("chatInput", "")

            val = validate_transcript(chat_input, data.persona_name, data.source)
            trace.append(self.trace_step("validate_transcript", {"chars": len(chat_input or "")}, {
                "valid": val.valid, "reason": val.reason, "flags": val.flags, "stats": val.stats,
            }))
            if not val.valid:
                return AgentResult(
                    job_id=job.job_id,
                    workflow=self.name,
                    status="success",
                    output={"runId": run_id, "status": "invalid", "valid": False,
                            "reason": val.reason, "persona": data.persona_name},
                    metrics={"status": "invalid", "reason": val.reason},
                    trace=trace,
                )

            system = build_system_message(data.persona_prompt)
            analysis, used_llm = self._coach(system, val.agent_input, data.persona_name, trace)

            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            stats = {**(val.stats or {}), "transcript": val.transcript, "source": val.source}
            row = build_row(analysis, stats, data.persona_name, today)
            report = build_report(analysis, row, data.persona_name, val.flags, val.stats or {})

            output: dict[str, Any] = {
                "runId": run_id,
                "status": "ok",
                "persona": data.persona_name,
                "source": data.source,
                "flags": val.flags,
                "analysis": analysis,
                "row": row.as_dict(),
                "report_markdown": report,
                "used_llm": used_llm,
            }
            trace.append(self.trace_step("compose_output", None, {"status": "ok", "persona": data.persona_name}))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output,
                metrics={
                    "status": "ok",
                    "persona": data.persona_name,
                    "performance_score": row.performance_score,
                    "client_score": row.client_score,
                    "used_llm": used_llm,
                    "model": "hermes" if used_llm else "offline",
                },
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

    # ---- the coach pass (LLM, parse-and-retry, with offline fallback) ----
    # hermes occasionally drops a required key; retry a couple times before the offline stub so
    # an interactive "Analyze" always returns a usable, schema-complete analysis.
    _MAX_LLM_ATTEMPTS = 3

    def _coach(
        self, system: str, agent_input: str, persona_name: str, trace: list[AgentTraceStep]
    ) -> tuple[dict, bool]:
        if self.llm is not None:
            for attempt in range(1, self._MAX_LLM_ATTEMPTS + 1):
                try:
                    raw = self.llm.complete_json(
                        system_prompt=system, user_prompt=agent_input, temperature=0.2
                    )
                    analysis = parse_analysis_json(raw)
                    trace.append(self.trace_step("sales_coach", {"attempt": attempt}, analysis))
                    return analysis, True
                except (ParseError, ValueError) as exc:
                    trace.append(self.trace_step(
                        "sales_coach_retry", {"attempt": attempt, "error": str(exc)[:160]}, None
                    ))
                except Exception as exc:
                    trace.append(self.trace_step(
                        "sales_coach_error", {"attempt": attempt, "error": str(exc)[:160]}, None
                    ))
                    break
        analysis = offline_coach(persona_name)
        trace.append(self.trace_step("sales_coach_offline", None, {"used": "offline_stub"}))
        return analysis, False

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)

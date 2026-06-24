import json
import re
from typing import Any

from erp_agents.clients.llm_client import LlmClient
from erp_agents.core.job import AgentJob
from erp_agents.core.result import AgentResult, AgentTraceStep
from erp_agents.core.workflow import Workflow
from erp_agents.workflows.engage.reply_glock.models import (
    CampaignContext,
    ExtractedSignals,
    NormalizedReply,
    ReplyClassification,
    ReplyDraft,
    ReplyGlockInput,
    ReplyGlockOutput,
    SchedulingVerdict,
    ThreadMessage,
    parse_scheduling,
)
from erp_agents.workflows.engage.reply_glock.prompts import (
    CLASSIFY_SYSTEM_PROMPT,
    CLASSIFY_USER_PROMPT_TEMPLATE,
    DRAFT_SYSTEM_PROMPT,
    DRAFT_USER_PROMPT_TEMPLATE,
)
from erp_agents.workflows.engage.reply_glock.tools import (
    clean_email_body,
    default_snooze_date,
    recommended_action_for_status,
    ui_bucket_for_status,
)

# Deterministic language pick for the draft: German ONLY when the prospect's reply is
# clearly German, otherwise English. The LLM is unreliable at self-detecting language
# (Hermes sometimes drafts German for an English reply), so we decide in code and pin
# it with a hard directive. Bias to English unless there is a strong German signal.
_GERMAN_CHARS = set("äöüßÄÖÜ")
_GERMAN_WORDS = {
    "der", "die", "das", "und", "wir", "sie", "ich", "nicht", "ein", "eine", "ist",
    "danke", "mit", "für", "sind", "haben", "kein", "keine", "gerade", "aktuell",
    "budget", "uns", "unser", "unsere", "vielen", "gruß", "grüße", "hallo", "bitte",
    "derzeit", "momentan", "zurück", "melden", "kontaktieren", "interesse", "leider",
    "jetzt", "nächste", "nächsten", "quartal", "jahr", "wäre", "können", "möchten",
}


def detect_language(text: str) -> str:
    """'de' when the text is clearly German, else 'en' (the default)."""
    t = (text or "").lower()
    if any(c in _GERMAN_CHARS for c in t):
        return "de"
    words = re.findall(r"[a-zäöüß]+", t)
    hits = sum(1 for w in words if w in _GERMAN_WORDS)
    return "de" if hits >= 2 else "en"


# Maps each status to the draft's purpose when the LLM omits/garbles it.
_DEFAULT_PURPOSE: dict[str, str] = {
    "INTERESTED": "MOVE_TO_MEETING",
    "UNSURE": "ANSWER_QUESTION",
    "UNINTERESTED": "CLOSE_POLITELY",
    "TEMPORARY": "SCHEDULE_FUTURE_FOLLOW_UP",
}


class ReplyGlockWorkflow(Workflow):
    """Engage reply classifier + response drafter.

    Faithful to the n8n REPLY GLOCK (PG) classification + draft brain. In the ERP-driven model
    the agent only classifies and drafts; the backend owns sending, booking, graduation, and
    persistence (the n8n side-effect subtrees). Pure JSON in -> structured AgentResult out.
    """

    name = "engage.reply_glock"

    def __init__(self, llm: LlmClient | None = None) -> None:
        self.llm = llm or LlmClient()

    def run(self, job: AgentJob) -> AgentResult:
        trace: list[AgentTraceStep] = []
        try:
            workflow_input = self.validate_input(job.input)
            trace.append(self.trace_step("validate_input", job.input, workflow_input.model_dump()))

            normalized = self.normalize_reply(workflow_input)
            trace.append(
                self.trace_step("normalize_reply", {"body": workflow_input.body}, normalized.model_dump())
            )

            # Interactive re-draft ("Write & Fix"): the bucket is already known, so
            # skip the classifier LLM call entirely — one fewer call to fail, and the
            # revision can't accidentally re-bucket the reply.
            if workflow_input.instruction and workflow_input.prior_status:
                classification = ReplyClassification(
                    status=workflow_input.prior_status,
                    confidence=1.0,
                    reasoning="interactive re-draft",
                    extracted_signals=ExtractedSignals(),
                )
                scheduling = SchedulingVerdict()
                trace.append(
                    self.trace_step(
                        "redraft_skip_classify", None, {"status": classification.status}
                    )
                )
            else:
                classification, scheduling, classify_trace = self.classify_reply(
                    workflow_input=workflow_input, normalized=normalized
                )
                trace.extend(classify_trace)

            draft, draft_trace = self.draft_reply(
                workflow_input=workflow_input, normalized=normalized, classification=classification
            )
            trace.extend(draft_trace)

            output = self.compose_output(
                workflow_input=workflow_input,
                normalized=normalized,
                classification=classification,
                draft=draft,
                scheduling=scheduling,
            )
            trace.append(self.trace_step("compose_output", None, output.model_dump()))

            return AgentResult(
                job_id=job.job_id,
                workflow=self.name,
                status="success",
                output=output.model_dump(),
                metrics={
                    "status": output.status,
                    "confidence": output.confidence,
                    "recommended_action": output.recommended_action,
                    "thread_messages": len(workflow_input.previous_thread),
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

    # ---- steps ----
    def validate_input(self, payload: dict[str, Any]) -> ReplyGlockInput:
        return ReplyGlockInput.model_validate(payload)

    def normalize_reply(self, workflow_input: ReplyGlockInput) -> NormalizedReply:
        clean_body, flags = clean_email_body(workflow_input.body)
        return NormalizedReply(
            clean_body=clean_body,
            detected_language=None,
            removed_quoted_text=flags["removed_quoted_text"],
            removed_signature=flags["removed_signature"],
        )

    def classify_reply(
        self, *, workflow_input: ReplyGlockInput, normalized: NormalizedReply
    ) -> tuple[ReplyClassification, SchedulingVerdict, list[AgentTraceStep]]:
        trace: list[AgentTraceStep] = []
        user_prompt = CLASSIFY_USER_PROMPT_TEMPLATE.format(
            campaign_context=self.serialize_campaign_context(workflow_input.campaign_context),
            proposed_slots=self.serialize_proposed_slots(workflow_input.proposed_slots),
            thread=self.serialize_previous_thread(workflow_input.previous_thread),
            sender_name=workflow_input.sender_name or "Unknown",
            company=workflow_input.company or "Unknown",
            subject=workflow_input.subject,
            clean_body=normalized.clean_body,
        )
        trace.append(self.trace_step("classify_prompt", {"system": CLASSIFY_SYSTEM_PROMPT}, {"user": user_prompt}))

        raw = self.llm.complete_json(
            system_prompt=CLASSIFY_SYSTEM_PROMPT, user_prompt=user_prompt, temperature=0.1
        )
        trace.append(self.trace_step("classify_llm", {"model_call": "classify"}, raw))

        classification = ReplyClassification.model_validate(raw)
        # Map the model's raw scheduling JSON through the pure validator (clamps a bad
        # index to None). Tolerate a missing/garbled "scheduling" key by passing {}.
        raw_sched = raw.get("scheduling") if isinstance(raw, dict) else None
        scheduling = parse_scheduling(
            raw_sched if isinstance(raw_sched, dict) else {}, workflow_input.proposed_slots
        )
        return classification, scheduling, trace

    def draft_reply(
        self,
        *,
        workflow_input: ReplyGlockInput,
        normalized: NormalizedReply,
        classification: ReplyClassification,
    ) -> tuple[ReplyDraft, list[AgentTraceStep]]:
        trace: list[AgentTraceStep] = []
        user_prompt = DRAFT_USER_PROMPT_TEMPLATE.format(
            campaign_context=self.serialize_campaign_context(workflow_input.campaign_context),
            status=classification.status,
            reasoning=classification.reasoning,
            signals=json.dumps(classification.extracted_signals.model_dump()),
            sender_name=workflow_input.sender_name or "Unknown",
            company=workflow_input.company or "Unknown",
            subject=workflow_input.subject,
            clean_body=normalized.clean_body,
        )
        # Pin the output language deterministically (German iff the prospect's reply is
        # clearly German, else English) — overrides the model's flaky self-detection.
        lang = detect_language(normalized.clean_body)
        lang_name = "German" if lang == "de" else "English"
        user_prompt += (
            f"\n\nOUTPUT LANGUAGE — STRICT: the prospect wrote in {lang_name}. "
            f"Write the ENTIRE reply — subject AND body — in {lang_name} only. "
            f"Do not use any other language."
        )
        # Persona (F4): imitate a salesperson's voice/pattern. Training notes (F3):
        # accumulated operator preferences the draft must always honour. Instruction:
        # a one-off interactive revision of the current draft ("Write & Fix").
        if workflow_input.persona:
            user_prompt += (
                "\n\nPERSONA — write in this salesperson's voice, rhythm, and "
                "persuasion pattern (embody the style; do NOT name or mention them):\n"
                f"{workflow_input.persona}"
            )
        if workflow_input.guidance:
            notes = "\n".join(f"- {g}" for g in workflow_input.guidance if g)
            if notes:
                user_prompt += (
                    "\n\nLEARNED PREFERENCES — operator instructions you must ALWAYS "
                    f"apply to this campaign's replies:\n{notes}"
                )
        if workflow_input.instruction:
            cur = workflow_input.current_draft or {}
            if cur.get("body"):
                user_prompt += (
                    "\n\nCURRENT DRAFT (revise THIS — keep what works, change only "
                    f"what the instruction asks):\nSubject: {cur.get('subject', '')}\n"
                    f"{cur.get('body', '')}"
                )
            user_prompt += (
                "\n\nOPERATOR INSTRUCTION — apply this change to the draft:\n"
                f"{workflow_input.instruction}"
            )
        trace.append(self.trace_step("draft_prompt", {"system": DRAFT_SYSTEM_PROMPT}, {"user": user_prompt}))

        # Ask for the body as PLAIN TEXT (not JSON). A small local model reliably
        # writes prose but routinely mangles a requested JSON shape — which used to
        # fail ReplyDraft validation and silently drop the draft.
        # Prefer the configured draft model (e.g. a locally hosted Qwen-32B). If the
        # gateway doesn't serve it yet (model-not-found / error), fall back to the
        # default model so drafting never breaks while a model is brought online.
        try:
            text = self.llm.complete_text(
                system_prompt=DRAFT_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.3,
                model=self.llm.draft_model,
            )
        except Exception:
            if self.llm.draft_model == self.llm.model:
                raise
            text = self.llm.complete_text(
                system_prompt=DRAFT_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                temperature=0.3,
                model=self.llm.model,
            )
        body = self._clean_draft_text(text)
        trace.append(self.trace_step("draft_llm", {"model_call": "draft"}, {"body": body}))
        if not body:
            raise ValueError("model returned an empty draft body")

        subject = (workflow_input.subject or "").strip()
        if not re.match(r"^(re:|aw:)", subject, flags=re.IGNORECASE):
            subject = f"Re: {subject}" if subject else "Re: your message"
        draft = ReplyDraft(
            subject=subject,
            body=body,
            purpose=_DEFAULT_PURPOSE[classification.status],
        )
        return draft, trace

    # Coerce whatever the model returns into a clean email body: strip code fences,
    # a leading "Subject:" line, wrapping quotes, and — if it STILL handed back JSON
    # — pull the body/response/content field out of it.
    @staticmethod
    def _clean_draft_text(text: str) -> str:
        t = (text or "").strip()
        if t.startswith("```"):
            t = re.sub(r"^```[a-zA-Z]*\n?", "", t)
            t = re.sub(r"\n?```$", "", t).strip()
        if t.startswith("{"):
            try:
                obj = json.loads(t)
                for key in ("body", "response", "content", "text", "message", "email", "reply"):
                    val = obj.get(key) if isinstance(obj, dict) else None
                    if isinstance(val, str) and val.strip():
                        t = val.strip()
                        break
            except json.JSONDecodeError:
                pass
        t = re.sub(r"^\s*subject:.*\n+", "", t, flags=re.IGNORECASE)
        # Cut trailing meta-commentary OR an echoed prompt-injection header that the
        # model sometimes appends after the email body ("OUTPUT LANGUAGE — ...",
        # "PERSONA — ...", "LEARNED PREFERENCES ...", "OPERATOR INSTRUCTION ...",
        # "CURRENT DRAFT ...", "Operator instructions followed: ...", "Note: ...").
        t = re.split(
            r"\n+\s*(?:operator instruction|instructions?\s+(?:followed|applied|met|incorporated)"
            r"|output language|learned preferences|current draft|persona\s*[\s—:-]"
            r"|note\s*:|notes?\s*:|\(note)",
            t,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[0].strip()
        if len(t) >= 2 and t[0] in "\"'" and t[-1] == t[0]:
            t = t[1:-1].strip()
        return t.strip()

    def compose_output(
        self,
        *,
        workflow_input: ReplyGlockInput,
        normalized: NormalizedReply,
        classification: ReplyClassification,
        draft: ReplyDraft,
        scheduling: SchedulingVerdict,
    ) -> ReplyGlockOutput:
        signals = classification.extracted_signals
        follow_up_needed = classification.status in ("TEMPORARY", "UNSURE")
        # For TEMPORARY, fall back to the +60d snooze window when the lead gave no explicit date.
        follow_up_window = signals.follow_up_date_or_window
        if classification.status == "TEMPORARY" and not follow_up_window:
            follow_up_window = default_snooze_date()

        return ReplyGlockOutput(
            reply_id=workflow_input.reply_id,
            campaign_id=workflow_input.campaign_id,
            lead_id=workflow_input.lead_id,
            status=classification.status,
            confidence=classification.confidence,
            reasoning=classification.reasoning,
            sender_name=workflow_input.sender_name,
            sender_email=workflow_input.sender_email,
            company=workflow_input.company,
            original_subject=workflow_input.subject,
            clean_body=normalized.clean_body,
            extracted_signals=signals,
            recommended_action=recommended_action_for_status(classification.status),
            draft=draft,
            follow_up_needed=follow_up_needed,
            follow_up_date_or_window=follow_up_window,
            scheduling=scheduling,
            ui=ui_bucket_for_status(classification.status),
        )

    # ---- helpers ----
    @staticmethod
    def serialize_campaign_context(ctx: CampaignContext | None) -> str:
        if ctx is None:
            return "No campaign context provided."
        return (
            f"Campaign: {ctx.campaign_name}\n"
            f"Product/Service: {ctx.product_or_service}\n"
            f"Offer: {ctx.offer}\n"
            f"Sender: {ctx.sender_name} ({ctx.sender_company})"
        )

    @staticmethod
    def serialize_proposed_slots(slots: list[dict]) -> str:
        """Number the offered slots from 0 so the model can accept one BY INDEX."""
        if not slots:
            return "No slots were offered to this lead yet."
        lines = []
        for i, slot in enumerate(slots):
            start = slot.get("start", "?") if isinstance(slot, dict) else str(slot)
            end = slot.get("end", "?") if isinstance(slot, dict) else "?"
            lines.append(f"[{i}] {start} -> {end}")
        return "\n".join(lines)

    @staticmethod
    def serialize_previous_thread(thread: list[ThreadMessage]) -> str:
        if not thread:
            return "No previous messages."
        lines = []
        for msg in thread:
            who = msg.from_name or msg.from_email or msg.direction
            lines.append(f"[{msg.direction}] {who}: {msg.body}")
        return "\n".join(lines)

    @staticmethod
    def trace_step(
        name: str,
        input: dict[str, Any] | None = None,
        output: dict[str, Any] | None = None,
    ) -> AgentTraceStep:
        return AgentTraceStep(name=name, input=input, output=output)

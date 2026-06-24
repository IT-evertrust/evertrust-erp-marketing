"""Regression: a coaching persona must never leak call-coaching / transcript rubric
scaffolding into the outbound email body.

The `persona` fed to the drafter is the SAME `personas.system_prompt` Activate uses for
call coaching, so it can carry rubric scaffolding ("[00:00] - [00:10] Value Equation\n
Strengths:\n- ..."). A weak local draft model echoes that rubric after the sign-off.
draft_body must be the email and nothing else.
"""

from erp_agents.workflows.engage.reply_glock.models import (
    ExtractedSignals,
    NormalizedReply,
    ReplyClassification,
    ReplyGlockInput,
)
from erp_agents.workflows.engage.reply_glock.workflow import ReplyGlockWorkflow

# A persona that doubles as an Activate call-coaching prompt: a normal voice preamble
# followed by transcript-timestamp + rubric scaffolding.
_COACHING_PERSONA = (
    "You are Hanna Nguyen, a warm, decisive EVERTRUST sales rep.\n\n"
    "Analyze the call transcript. For each strength and weakness, copy the relevant "
    "line's [mm:ss] timestamp and tag the methodology pattern.\n"
    "[00:00] - [00:10] Value Equation\n"
    "Strengths:\n"
    "- Articulated the dream outcome\n"
)

# What the (weak) draft model actually returns: a real email, then leaked rubric.
_LEAKED_DRAFT = (
    "Hi Maria,\n\n"
    "Thanks for getting back to us — happy to send the catalogue today.\n\n"
    "Best regards,\nHanna\n\n"
    "[00:00] - [00:10] Value Equation\n"
    "Strengths:\n"
    "- Client company: Granozita GmbH\n"
    "- Salesperson articulated the dream outcome\n"
)

_SCAFFOLDING_TOKENS = ("[00:00]", "[00:10]", "Strengths:", "Value Equation")


class _FakeLlm:
    """Captures the draft user-prompt and returns a canned completion."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.model = "fake-default"
        self.draft_model = "fake-draft"
        self.last_user_prompt: str | None = None

    def complete_text(self, *, system_prompt, user_prompt, temperature=0.3, model=None):
        self.last_user_prompt = user_prompt
        return self.text


def _classification():
    return ReplyClassification(
        status="INTERESTED",
        confidence=0.9,
        reasoning="asks for the catalogue",
        extracted_signals=ExtractedSignals(),
    )


def _input(**overrides):
    base = dict(
        reply_id="r1",
        campaign_id="c1",
        sender_email="granozita@gmail.com",
        sender_name="Maria",
        company="Granozita GmbH",
        subject="Re: catalogue",
        body="Can you send me the catalogue?",
    )
    base.update(overrides)
    return ReplyGlockInput(**base)


def test_clean_draft_strips_trailing_coaching_scaffolding():
    cleaned = ReplyGlockWorkflow._clean_draft_text(_LEAKED_DRAFT)
    for tok in _SCAFFOLDING_TOKENS:
        assert tok not in cleaned, f"scaffolding {tok!r} leaked into body"
    assert "Thanks for getting back to us" in cleaned
    assert cleaned.rstrip().endswith("Hanna")


def test_draft_reply_does_not_leak_persona_coaching_rubric():
    fake = _FakeLlm(_LEAKED_DRAFT)
    wf = ReplyGlockWorkflow(llm=fake)
    wi = _input(persona=_COACHING_PERSONA)
    draft, _trace = wf.draft_reply(
        workflow_input=wi,
        normalized=NormalizedReply(clean_body=wi.body),
        classification=_classification(),
    )
    for tok in _SCAFFOLDING_TOKENS:
        assert tok not in draft.body, f"scaffolding {tok!r} leaked into draft_body"
    assert "Hanna" in draft.body  # the email itself survived


def test_clean_draft_keeps_inline_bracketed_time():
    """A bracketed clock time inside a sentence is NOT transcript scaffolding — the body
    must survive intact (the timestamp marker only triggers at the start of a line)."""
    body = "Hi Maria,\n\nLet's meet at [14:00] on Tuesday.\n\nBest,\nHanna"
    assert ReplyGlockWorkflow._clean_draft_text(body) == body


def test_clean_draft_keeps_inline_strengths_prose():
    """An inline 'Strengths: ...' sentence is normal prose — only a standalone
    'Strengths:' header line is a coaching rubric, so the body must survive intact."""
    body = (
        "Hi Maria,\n\nStrengths: durability and price are where we win.\n\n"
        "Best,\nHanna"
    )
    assert ReplyGlockWorkflow._clean_draft_text(body) == body


def test_clean_draft_strips_standalone_rubric_header_without_timestamp():
    """The rubric can leak without a timestamp — a standalone 'Strengths:' header line
    (followed by bullets) is still cut."""
    body = (
        "Hi Maria,\n\nThanks — catalogue on its way.\n\nBest,\nHanna\n\n"
        "Strengths:\n- Articulated the dream outcome\n- Named the budget early\n"
    )
    cleaned = ReplyGlockWorkflow._clean_draft_text(body)
    assert "Strengths:" not in cleaned
    assert "dream outcome" not in cleaned
    assert cleaned.rstrip().endswith("Hanna")


def test_redraft_does_not_re_prime_from_leaked_current_draft():
    """never-include on the interactive re-draft path: a prior draft that still carries
    scaffolding must not re-prime the model."""
    fake = _FakeLlm("Hi Maria,\n\nShorter version.\n\nBest,\nHanna")
    wf = ReplyGlockWorkflow(llm=fake)
    wi = _input(
        instruction="make it shorter",
        prior_status="INTERESTED",
        current_draft={"subject": "Re: catalogue", "body": _LEAKED_DRAFT},
    )
    wf.draft_reply(
        workflow_input=wi,
        normalized=NormalizedReply(clean_body=wi.body),
        classification=_classification(),
    )
    assert fake.last_user_prompt is not None
    assert "[00:00]" not in fake.last_user_prompt
    assert "Strengths:" not in fake.last_user_prompt


def test_coaching_scaffolding_not_injected_into_draft_prompt():
    """never-include: the transcript/rubric scaffolding is scrubbed from the persona
    before it primes the drafter."""
    fake = _FakeLlm("Hi Maria,\n\nThanks!\n\nBest,\nHanna")
    wf = ReplyGlockWorkflow(llm=fake)
    wi = _input(persona=_COACHING_PERSONA)
    wf.draft_reply(
        workflow_input=wi,
        normalized=NormalizedReply(clean_body=wi.body),
        classification=_classification(),
    )
    assert fake.last_user_prompt is not None
    assert "[00:00]" not in fake.last_user_prompt
    assert "Strengths:" not in fake.last_user_prompt
    # the voice preamble is preserved
    assert "warm, decisive EVERTRUST sales rep" in fake.last_user_prompt

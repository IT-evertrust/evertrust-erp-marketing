from erp_agents.workflows.engage.reply_glock.prompts import DRAFT_SYSTEM_PROMPT


def test_draft_prompt_forbids_inventing_times():
    """The drafter must never write its own meeting time — the system appends the
    authoritative, timezone-correct time beneath the message. (Bug: the LLM invented
    '17:45' which matched neither the booked slot nor any configured timezone.)"""
    p = DRAFT_SYSTEM_PROMPT.lower()
    assert "do not state" in p or "never state" in p
    assert "time" in p and ("below" in p or "appended" in p)

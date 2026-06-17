from sales.domain.transcript import (
    LOW_ENGAGEMENT_CONTEXT,
    adapt_readai,
    flatten_erp,
    validate_transcript,
)


def _long_transcript(turns_words):
    """Build a [mm:ss] Speaker: words block from (speaker, words) pairs."""
    return "\n".join(f"[00:0{i}] {sp}: {w}" for i, (sp, w) in enumerate(turns_words))


def test_validate_empty_input():
    assert validate_transcript("").valid is False
    assert validate_transcript("").reason == "empty_input"
    assert validate_transcript(None).reason == "empty_input"
    assert validate_transcript(123).reason == "empty_input"


def test_validate_too_short():
    text = "[00:01] Alex: hello there\n[00:02] Bob: hi\n[00:03] Alex: ok\n[00:04] Bob: bye"
    r = validate_transcript(text)
    assert r.valid is False and r.reason == "transcript_too_short"


def test_validate_too_few_speaker_turns():
    # >=100 words but only 2 turns
    big = " ".join(["word"] * 120)
    text = f"[00:01] Alex: {big}\n[00:02] Bob: ok thanks"
    r = validate_transcript(text)
    assert r.valid is False and r.reason == "too_few_speaker_turns"


def test_validate_no_salesperson_speech():
    # first speaker barely talks; 4+ turns; >=100 words
    big = " ".join(["word"] * 120)
    text = (
        "[00:01] Alex: hi\n"
        f"[00:02] Bob: {big}\n"
        "[00:03] Carol: more words here please thanks a lot\n"
        "[00:04] Dan: and even more words to pad this out nicely now"
    )
    r = validate_transcript(text)
    assert r.valid is False and r.reason == "no_salesperson_speech"


def test_validate_ok_no_flags():
    big = " ".join(["word"] * 40)
    text = "\n".join(f"[00:0{i}] {sp}: {big}" for i, sp in enumerate(["Alex", "Bob", "Alex", "Bob"]))
    r = validate_transcript(text, "Alex Hormozi", "readai")
    assert r.valid is True
    assert r.flags == []
    assert r.active_persona_name == "Alex Hormozi"
    assert r.source == "readai"
    assert r.agent_input == r.transcript  # no context prefix when no flag
    assert r.stats["turns"] == 4


def test_validate_low_engagement_flag_and_context_prefix():
    big = " ".join(["word"] * 60)
    # Alex dominates, others barely speak -> otherShare < 0.05 -> low_client_engagement
    text = (
        f"[00:01] Alex: {big}\n"
        f"[00:02] Alex: {big}\n"
        f"[00:03] Alex: {big}\n"
        "[00:04] Bob: ok"
    )
    r = validate_transcript(text)
    assert r.valid is True
    assert "low_client_engagement" in r.flags
    assert r.agent_input.startswith(LOW_ENGAGEMENT_CONTEXT)
    assert r.transcript in r.agent_input


def test_adapt_readai_timestamps_and_offset():
    body = {
        "transcript": {"speaker_blocks": [
            {"speaker": {"name": "Hanna"}, "words": "hello", "start_time": 10000},
            {"speaker": {"name": "Markus"}, "words": "hi there", "start_time": 95000},
        ]}
    }
    out = adapt_readai(body)
    # offset from first block (10000ms) -> first is 00:00, second is (95000-10000)/1000=85s=01:25
    assert "[00:00] Hanna: hello" in out["chatInput"]
    assert "[01:25] Markus: hi there" in out["chatInput"]


def test_adapt_readai_missing_transcript():
    out = adapt_readai({"summary": "x"})
    assert out["chatInput"] == ""
    assert out["_readai_error"] == "missing_transcript"


def test_adapt_readai_context_block():
    body = {
        "summary": "A summary",
        "topics": [{"text": "Pricing"}],
        "transcript": {"speaker_blocks": [
            {"speaker": {"name": "A"}, "words": "x", "start_time": 0},
        ]},
    }
    out = adapt_readai(body)
    assert "READ.AI CONTEXT" in out["chatInput"]
    assert "# Meeting Summary" in out["chatInput"]
    assert "TRANSCRIPT (primary)" in out["chatInput"]
    assert "[00:00] A: x" in out["chatInput"]


def test_adapt_readai_unknown_speaker_name():
    body = {"transcript": {"speaker_blocks": [{"words": "hi", "start_time": 0}]}}
    out = adapt_readai(body)
    assert "[00:00] Unknown: hi" in out["chatInput"]


def test_flatten_erp():
    body = {"body": {"persona": "Custom Persona", "transcript": {"speaker_blocks": [
        {"speaker": {"name": "Hanna"}, "words": "hi"},
        {"speaker": {"name": "Markus"}, "words": "hello"},
    ]}}}
    out = flatten_erp(body)
    assert out["chatInput"] == "Hanna: hi\nMarkus: hello"
    assert out["active_persona_name"] == "Custom Persona"
    assert out["source"] == "readai"  # §6.5 quirk preserved


def test_flatten_erp_default_persona():
    out = flatten_erp({"body": {"transcript": {"speaker_blocks": []}}})
    assert out["active_persona_name"] == "Alex Hormozi"

import base64

from rag.domain.models import UnsureLead
from rag.domain.thread import build_thread_context


def _b64(s: str) -> str:
    return base64.urlsafe_b64encode(s.encode()).decode()


def _msg(mid, tid, frm, subject, body, ts, use_data=True):
    payload = {"headers": [
        {"name": "From", "value": frm},
        {"name": "Subject", "value": subject},
        {"name": "Date", "value": "Mon, 09 Jun 2026 10:00 +0200"},
    ]}
    if use_data:
        payload["body"] = {"data": _b64(body)}
    return {"id": mid, "threadId": tid, "internalDate": str(ts), "snippet": body, "payload": payload}


LEAD = UnsureLead(
    lead_email="lead@acme.com", company_name="Acme", country="DE",
    campaign_id=1, campaign_name="C", sent_from="info@evertrust-germany.de",
)


def test_returns_none_without_lead_message():
    msgs = [_msg("m1", "t1", "info@evertrust-germany.de", "Hi", "body", 1000)]
    assert build_thread_context(msgs, LEAD) is None


def test_labels_lead_and_evertrust():
    msgs = [
        _msg("m1", "t1", "Evertrust <info@evertrust-germany.de>", "Hi", "outreach", 1000),
        _msg("m2", "t1", "Lead <lead@acme.com>", "Re: Hi", "their reply", 2000),
    ]
    ctx = build_thread_context(msgs, LEAD)
    assert ctx is not None
    assert "[EVERTRUST]" in ctx.formatted_thread
    assert "[LEAD]" in ctx.formatted_thread
    assert ctx.client_reply_email == "lead@acme.com"


def test_sorted_ascending_by_internaldate():
    msgs = [
        _msg("m2", "t1", "lead@acme.com", "second", "BBB", 2000),
        _msg("m1", "t1", "info@evertrust-germany.de", "first", "AAA", 1000),
    ]
    ctx = build_thread_context(msgs, LEAD)
    assert ctx.formatted_thread.index("AAA") < ctx.formatted_thread.index("BBB")


def test_keeps_only_last_n_messages():
    msgs = [_msg(f"m{i}", "t1", "info@evertrust-germany.de", "x", f"body{i}", i)
            for i in range(30)]
    # add a lead message at the very end so context is kept
    msgs.append(_msg("mlead", "t1", "lead@acme.com", "x", "leadbody", 999))
    ctx = build_thread_context(msgs, LEAD, msgs_cap=20)
    # 20 blocks total
    assert ctx.formatted_thread.count("--- ") == 20
    assert "leadbody" in ctx.formatted_thread


def test_body_capped():
    long_body = "z" * 5000
    msgs = [_msg("m1", "t1", "lead@acme.com", "x", long_body, 1000)]
    ctx = build_thread_context(msgs, LEAD, body_cap=2000)
    assert "z" * 2000 in ctx.formatted_thread
    assert "z" * 2001 not in ctx.formatted_thread


def test_dedup_key_format():
    msgs = [_msg("mlast", "t99", "lead@acme.com", "x", "body", 1000)]
    ctx = build_thread_context(msgs, LEAD)
    assert ctx.dedup_key == "lead@acme.com|t99|mlast"


def test_thread_id_param_used_when_messages_lack_it():
    msgs = [{"id": "m1", "internalDate": "1000", "snippet": "hi",
             "payload": {"headers": [{"name": "From", "value": "lead@acme.com"}]}}]
    ctx = build_thread_context(msgs, LEAD, thread_id="forced")
    assert ctx.dedup_key == "lead@acme.com|forced|m1"


def test_falls_back_to_snippet_when_no_body_data():
    msgs = [_msg("m1", "t1", "lead@acme.com", "x", "snippet text here", 1000, use_data=False)]
    ctx = build_thread_context(msgs, LEAD)
    assert "snippet text here" in ctx.formatted_thread

from rag.clients.llm import offline_analyze
from rag.domain.models import UnsureLead
from rag.domain.parse import parse_reply

LEAD = UnsureLead(
    lead_email="lead@acme.com", company_name="Acme", country="DE",
    campaign_id=1, campaign_name="C", sent_from="info@evertrust-germany.de",
)


def test_offline_stub_is_valid_parseable_output():
    raw = offline_analyze(LEAD, None)
    out = parse_reply(raw)  # must pass enum validation
    assert out.unsure_area == "Operation"
    assert out.citations == []
    assert "Acme" in out.draft_reply
    assert "Hanna Nguyen" in out.draft_reply
    assert out.subject


def test_offline_stub_handles_missing_company():
    bare = UnsureLead(
        lead_email="x@y.com", company_name="", country="", campaign_id=1,
        campaign_name="", sent_from="",
    )
    out = parse_reply(offline_analyze(bare, None))
    assert out.unsure_area == "Operation"

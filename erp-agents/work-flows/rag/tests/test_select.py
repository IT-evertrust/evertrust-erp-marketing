from rag.domain.select import cap, extract_email, extract_unsure_leads
from rag.domain.enums import HANNA_ADDRESS, INFO_ADDRESS

CAMPAIGN = {"id": 7, "name": "Demo"}


def test_filters_to_unsure_only():
    rows = [
        {"status": "unsure", "email": "a@x.com", "company_name": "A"},
        {"status": "Interested", "email": "b@x.com", "company_name": "B"},
        {"status": "NOT INTERESTED", "email": "c@x.com", "company_name": "C"},
    ]
    out = extract_unsure_leads(rows, CAMPAIGN)
    assert [l.lead_email for l in out] == ["a@x.com"]


def test_status_trimmed_and_lowered():
    rows = [{"status": "  UnSuRe ", "email": "a@x.com"}]
    assert len(extract_unsure_leads(rows, CAMPAIGN)) == 1


def test_dedupe_by_email_keeps_first():
    rows = [
        {"status": "unsure", "email": "dup@x.com", "company_name": "First"},
        {"status": "unsure", "email": "DUP@x.com", "company_name": "Second"},
    ]
    out = extract_unsure_leads(rows, CAMPAIGN)
    assert len(out) == 1
    assert out[0].company_name == "First"


def test_skips_rows_without_valid_email():
    rows = [
        {"status": "unsure", "email": "not-an-email"},
        {"status": "unsure", "email": ""},
        {"status": "unsure", "email": "ok@x.com"},
    ]
    out = extract_unsure_leads(rows, CAMPAIGN)
    assert [l.lead_email for l in out] == ["ok@x.com"]


def test_email_extracted_from_noise_and_lowercased():
    assert extract_email("Foo Bar <Foo.Bar@Example.COM>") == "foo.bar@example.com"
    assert extract_email("nope") is None


def test_inbox_routing_hanna_vs_info():
    rows = [
        {"status": "unsure", "email": "h@x.com", "send_from": "Hanna Nguyen"},
        {"status": "unsure", "email": "i@x.com", "send_from": ""},
        {"status": "unsure", "email": "j@x.com", "Sent From": "info@evertrust-germany.de"},
    ]
    out = {l.lead_email: l for l in extract_unsure_leads(rows, CAMPAIGN)}
    assert out["h@x.com"].sent_from == HANNA_ADDRESS
    assert out["h@x.com"].account == "hanna"
    assert out["i@x.com"].sent_from == INFO_ADDRESS
    assert out["j@x.com"].sent_from == INFO_ADDRESS


def test_campaign_fields_propagated():
    rows = [{"status": "unsure", "email": "a@x.com", "id": 42, "country": "DE"}]
    out = extract_unsure_leads(rows, CAMPAIGN)[0]
    assert out.campaign_id == 7
    assert out.campaign_name == "Demo"
    assert out.lead_id == 42
    assert out.country == "DE"


def test_cap_limits_count():
    rows = [{"status": "unsure", "email": f"a{i}@x.com"} for i in range(15)]
    out = extract_unsure_leads(rows, CAMPAIGN)
    assert len(out) == 15
    assert len(cap(out, 10)) == 10

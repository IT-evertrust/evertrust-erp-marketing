from crm.domain.state import (
    compute, meetings_note, find_signing, hot_reason, norm, qualifies,
)

CAMPAIGN = {"id": 1, "niche": "cybersecurity", "project": "PLCyber"}


def test_norm():
    assert norm("Baltic Boxes Sp. z o.o.") == "balticboxes"
    assert norm("Müller GmbH") == "muller"


def test_qualifies_prefix_match():
    assert qualifies("Interested")
    assert qualifies("interested")
    assert qualifies("Meeting Scheduled")
    assert qualifies("Meeting Schedule")        # n8n prefix quirk: no 'd' still qualifies
    assert not qualifies("Cold Outreached")
    assert not qualifies("")
    assert not qualifies("Not Interested - Do Not Contact")


def test_hot_reason():
    assert hot_reason("Meeting Scheduled") == "MeetingScheduled"
    assert hot_reason("Interested") == "Interested"


def test_meetings_note_joins_history():
    m = [{"meeting_date": "2026-06-01", "meeting_outcome": "intro"},
         {"meeting_date": "2026-06-05", "title": "demo"}]
    assert meetings_note(m) == "2026-06-01: intro | 2026-06-05: demo"
    assert meetings_note([]) == ""
    # caps at first 5
    many = [{"meeting_date": f"2026-06-0{i}", "title": f"m{i}"} for i in range(1, 8)]
    assert meetings_note(many).count("|") == 4


def test_find_signing_boolean_and_string():
    assert find_signing([{"sign_now": False}, {"sign_now": True, "meeting_date": "x"}])["meeting_date"] == "x"
    assert find_signing([{"sign_now": "YES"}]) is not None
    assert find_signing([{"sign_now": False}]) is None


def test_intake_only_qualifying_leads():
    leads = [
        {"company_name": "A", "email": "a@x.pl", "status": "Interested"},
        {"company_name": "B", "email": "b@x.pl", "status": "Cold Outreached"},   # skipped
        {"company_name": "C", "email": "c@x.pl", "status": "Meeting Scheduled"},
    ]
    hot, cust = compute(CAMPAIGN, leads, {}, set())
    assert {h["email"] for h in hot} == {"a@x.pl", "c@x.pl"}
    assert cust == []   # no signings


def test_graduation_only_on_signing():
    leads = [{"company_name": "Acme", "email": "a@acme.pl", "status": "Meeting Scheduled"}]
    meetings = {norm("Acme"): [{"meeting_date": "2026-06-10", "sign_now": True,
                                "cooperation_term": "12 months", "meeting_outcome": "signed"}]}
    hot, cust = compute(CAMPAIGN, leads, meetings, set())
    assert hot[0]["contract_status"] == "Signed"
    assert hot[0]["final_meeting"] == "Signed 2026-06-10"
    assert len(cust) == 1 and cust[0]["cooperation_term"] == "12 months"


def test_meeting_scheduled_without_signing_no_graduation():
    leads = [{"company_name": "Acme", "email": "a@acme.pl", "status": "Meeting Scheduled"}]
    meetings = {norm("Acme"): [{"meeting_date": "2026-06-10", "sign_now": False}]}
    hot, cust = compute(CAMPAIGN, leads, meetings, set())
    assert hot[0]["contract_status"] == "" and cust == []   # NOT on Meeting Scheduled alone


def test_no_double_graduation_existing_customer():
    leads = [{"company_name": "Acme", "email": "a@acme.pl", "status": "Interested"}]
    meetings = {norm("Acme"): [{"meeting_date": "x", "sign_now": True}]}
    hot, cust = compute(CAMPAIGN, leads, meetings, {"a@acme.pl"})
    assert cust == []   # already a customer


def test_dedup_email_within_campaign():
    leads = [{"company_name": "A", "email": "a@x.pl", "status": "Interested"},
             {"company_name": "A2", "email": "A@X.PL", "status": "Meeting Scheduled"}]
    hot, _ = compute(CAMPAIGN, leads, {}, set())
    assert len(hot) == 1

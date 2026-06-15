from datetime import date, datetime
from zoneinfo import ZoneInfo

from glock.domain.classify import brace_slice, derive, offline_classify

TZ = ZoneInfo("Europe/Berlin")
NOW = datetime(2026, 6, 12, 10, 0, tzinfo=TZ)
TODAY = date(2026, 6, 12)


def test_interested_status():
    c = derive({"classification": "Interested"}, TODAY, NOW)
    assert c.classification == "Interested" and c.status == "Interested"


def test_unsure_status():
    c = derive({"classification": "Unsure"}, TODAY, NOW)
    assert c.status == "Unsure"


def test_permanent_no_is_do_not_contact():
    c = derive({"classification": "Not Interested", "niType": "permanent"}, TODAY, NOW)
    assert c.status == "Not Interested - Do Not Contact"


def test_temporary_no_appends_snooze_date_no_delimiter():
    c = derive({"classification": "Not Interested", "niType": "temporary"}, TODAY, NOW)
    assert c.status == "Not Interested - Snoozed2026-08-11"   # today + 60 days
    assert c.snooze_until == "2026-08-11"


def test_not_interested_defaults_to_temporary():
    c = derive({"classification": "Not Interested", "niType": ""}, TODAY, NOW)
    assert c.ni_type == "temporary" and c.status.startswith("Not Interested - Snoozed")


def test_proposed_future_time_kept():
    c = derive({"classification": "Interested", "proposedDateTime": "2026-06-20T15:00:00+02:00"},
               TODAY, NOW)
    assert c.proposed_start.startswith("2026-06-20T15:00")
    assert c.proposed_end.startswith("2026-06-20T15:30")


def test_proposed_past_time_ignored():
    c = derive({"classification": "Interested", "proposedDateTime": "2020-01-01T15:00:00+01:00"},
               TODAY, NOW)
    assert c.proposed_start == ""


def test_brace_slice_rescues_wrapped_json():
    assert brace_slice('```json\n{"classification":"Unsure"}\n```')["classification"] == "Unsure"
    assert brace_slice("garbage") is None


def test_offline_heuristic():
    assert offline_classify("Yes, let's schedule a call", TODAY, NOW).classification == "Interested"
    assert offline_classify("please unsubscribe me", TODAY, NOW).classification == "Not Interested"
    assert offline_classify("hmm, what is this about", TODAY, NOW).classification == "Unsure"

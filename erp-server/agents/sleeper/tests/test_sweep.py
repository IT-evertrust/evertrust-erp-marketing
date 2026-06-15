from datetime import date

from sleeper.domain.sweep import route_lead

TODAY = date(2026, 6, 12)


def test_do_not_contact_deletes():
    assert route_lead("Not Interested - Do Not Contact", TODAY) == ("delete", "do-not-contact")
    assert route_lead("Not Interested At All", TODAY)[0] == "delete"   # dual-vocab


def test_snooze_due_reengages():
    # clean status + a snooze_until date in the past
    action, detail = route_lead("Not Interested - Snoozed", TODAY, date(2026, 6, 1))
    assert action == "reengage"


def test_snooze_due_today_reengages():
    assert route_lead("Not Interested - Snoozed", TODAY, date(2026, 6, 12))[0] == "reengage"


def test_snooze_not_due_skips():
    action, detail = route_lead("Not Interested - Snoozed", TODAY, date(2026, 8, 11))  # future
    assert action == "skip" and "not due" in detail


def test_undated_snooze_skipped_not_swept():
    # the n8n bug swept these immediately; the port leaves them for manual review
    assert route_lead("Not Interested Temp", TODAY) == ("skip", "undated temp snooze — left for manual review")


def test_snooze_status_without_snooze_until_skips_safely():
    # clean snooze status but no structured date -> skip safely, never blind re-engage
    action, detail = route_lead("Not Interested - Snoozed", TODAY, None)
    assert action == "skip" and "snooze_until" in detail


def test_non_target_skipped():
    assert route_lead("Cold Outreached", TODAY)[0] == "skip"
    assert route_lead("", TODAY)[0] == "skip"
    assert route_lead("Interested", TODAY)[0] == "skip"

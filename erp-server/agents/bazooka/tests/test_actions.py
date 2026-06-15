"""Decision matrix (ERP edition): followup_count -> action + template key."""
from __future__ import annotations

from bazooka.domain.actions import compute_action
from bazooka.domain.models import Prospect

TEMPLATES = {"coldEmail": "c", "followUp": "f", "finalPush": "x"}


def _p(email="a@b.com", fc=0, status="NEW"):
    return Prospect(id="1", email=email, company_name="Co", followup_count=fc, status=status)


def test_new_is_cold():
    a = compute_action(_p(fc=0), TEMPLATES)
    assert a.action_type == "cold" and a.template_key == "coldEmail"


def test_followup_one():
    a = compute_action(_p(fc=1, status="EMAILED"), TEMPLATES)
    assert a.action_type == "followup" and a.template_key == "followUp"


def test_finalpush_two_plus():
    a = compute_action(_p(fc=3, status="EMAILED"), TEMPLATES)
    assert a.action_type == "finalpush" and a.template_key == "finalPush"


def test_invalid_email_skips():
    a = compute_action(_p(email="not-an-email"), TEMPLATES)
    assert a.action_type == "skip" and a.skip_reason == "INVALID_EMAIL"


def test_no_template_skips():
    a = compute_action(_p(fc=0), {})
    assert a.action_type == "skip" and a.skip_reason == "NO_TEMPLATE"


def test_followup_falls_back_to_cold_template():
    a = compute_action(_p(fc=1), {"coldEmail": "c"})
    assert a.action_type == "followup" and a.template_key == "coldEmail"

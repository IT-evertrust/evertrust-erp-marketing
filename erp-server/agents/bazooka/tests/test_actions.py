"""Decision matrix, aligned to zyCTVLpZj3YyR2qV: status + followup_count + COLD-AGG."""
from __future__ import annotations

from bazooka.domain.actions import compute_action
from bazooka.domain.models import News, Prospect, Template

TEMPLATES = {
    "COLD": Template("s", "cold body"),
    "COLD-AGG": Template("s", "aggressive body"),
    "FOLLOWUP": Template("s", "followup body"),
    "FINALPUSH": Template("s", "finalpush body"),
}
NO_NEWS = News("", False)
BAD_NEWS = News("isBadNews: true\n[BAD NEWS] something", True)


def _p(email="a@b.com", fc=0, status="NEW"):
    return Prospect(id="1", email=email, company_name="Co", followup_count=fc, status=status)


def test_new_is_cold():
    a = compute_action(_p(fc=0, status="NEW"), TEMPLATES, NO_NEWS)
    assert a.action_type == "cold" and a.template_block == "COLD"


def test_cold_agg_on_bad_news():
    a = compute_action(_p(fc=0, status="NEW"), TEMPLATES, BAD_NEWS)
    assert a.action_type == "cold" and a.template_block == "COLD-AGG"


def test_cold_agg_falls_back_when_block_empty():
    templates = {**TEMPLATES, "COLD-AGG": Template("", "")}
    a = compute_action(_p(fc=0), templates, BAD_NEWS)
    assert a.template_block == "COLD"


def test_followup_by_count():
    a = compute_action(_p(fc=1, status="NEW"), TEMPLATES, NO_NEWS)
    assert a.action_type == "followup" and a.template_block == "FOLLOWUP"


def test_followup_by_status_contacted():
    a = compute_action(_p(fc=0, status="CONTACTED"), TEMPLATES, NO_NEWS)
    assert a.action_type == "followup"


def test_finalpush_by_count():
    a = compute_action(_p(fc=2, status="NEW"), TEMPLATES, NO_NEWS)
    assert a.action_type == "finalpush" and a.template_block == "FINALPUSH"


def test_finalpush_by_status_emailed():
    a = compute_action(_p(fc=0, status="EMAILED"), TEMPLATES, NO_NEWS)
    assert a.action_type == "finalpush"


def test_invalid_email_skips():
    a = compute_action(_p(email="not-an-email"), TEMPLATES, NO_NEWS)
    assert a.action_type == "skip" and a.skip_reason == "INVALID_EMAIL"

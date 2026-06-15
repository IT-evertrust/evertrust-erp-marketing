from ammoforge.domain.news import build_news
from ammoforge.domain.templates import explode_blocks

META = dict(project="P", niche="cybersecurity", city="Anywhere", country="Poland",
            run_id="r1", today="2026-06-12")


def test_no_news_not_bad():
    r = build_news({"news": [], "hooks": [], "confidence": 0}, **META)
    assert not r.is_bad_news and r.item_count == 0
    assert "NO NEWS FOUND" in r.body
    assert "isBadNews: false" in r.body


def test_severe_bad_news_flags_true():
    parsed = {"news": [{"headline": "Ransomware wave hits EU", "category": "cyberattack",
                        "severity": 0.8, "sentiment": "bad", "url": "https://x"}],
              "hooks": ["urgent hook"], "confidence": 0.7}
    r = build_news(parsed, **META)
    assert r.is_bad_news
    assert "isBadNews: true" in r.body          # Bazooka-greppable token
    assert "[BAD NEWS" in r.body                 # Bazooka-greppable item label
    assert "SUGGESTED OUTREACH HOOKS" in r.body


def test_low_severity_not_bad():
    parsed = {"news": [{"headline": "minor", "category": "other", "severity": 0.3,
                        "sentiment": "bad", "url": "https://x"}], "confidence": 0.9}
    r = build_news(parsed, **META)
    assert not r.is_bad_news                      # top severity < 0.6


def test_low_confidence_not_bad():
    parsed = {"news": [{"headline": "x", "category": "cyberattack", "severity": 0.9,
                        "sentiment": "bad"}], "confidence": 0.2}
    r = build_news(parsed, **META)
    assert not r.is_bad_news                      # confidence < 0.4


def test_category_derives_bad_when_sentiment_missing():
    parsed = {"news": [{"headline": "breach", "category": "breach", "severity": 0.7}],
              "confidence": 0.6}
    r = build_news(parsed, **META)
    assert r.bad_count == 1 and r.is_bad_news


def test_good_news_not_counted_bad():
    parsed = {"news": [{"headline": "award", "category": "other", "sentiment": "good"}],
              "confidence": 0.8}
    r = build_news(parsed, **META)
    assert r.bad_count == 0 and not r.is_bad_news
    assert "professional template only" in r.body


def test_caps_at_10_items():
    parsed = {"news": [{"headline": f"n{i}", "severity": 0.1} for i in range(20)], "confidence": 0.5}
    r = build_news(parsed, **META)
    assert r.item_count == 10


def test_explode_blocks_keeps_company_placeholder():
    blocks = explode_blocks("CYBERSECURITY")
    assert [b["block"] for b in blocks] == ["COLD", "FOLLOWUP", "FINALPUSH"]
    assert all("{{Company Name}}" in b["body"] for b in blocks)
    assert "cybersecurity services" in blocks[0]["body"]

from sales.clients.llm import offline_coach
from sales.domain.parse import parse_analysis_json
from sales.domain.render import build_report, build_row
from sales.domain.rubric import (
    SALES_TECHNIQUE_GUIDE,
    STRICT_OUTPUT_FORMAT,
    build_system_message,
)


def test_build_system_message_contains_persona_and_verbatim_rubric():
    persona = "You are Alex Hormozi, a blunt sales coach."
    msg = build_system_message(persona)
    assert msg.startswith(persona)
    assert SALES_TECHNIQUE_GUIDE in msg
    assert STRICT_OUTPUT_FORMAT in msg
    assert "\n\n---\n\n" in msg


def test_rubric_verbatim_markers():
    # spot-check verbatim phrases from blueprint §4
    assert "## SALES TECHNIQUE ANALYSIS GUIDE" in SALES_TECHNIQUE_GUIDE
    assert "Hormozi would clip this for content" in SALES_TECHNIQUE_GUIDE
    assert "Specificity Beats Generality" in SALES_TECHNIQUE_GUIDE
    assert "## OUTPUT FORMAT (STRICT)" in STRICT_OUTPUT_FORMAT
    assert '"sales_technique_analysis"' in STRICT_OUTPUT_FORMAT


def test_offline_coach_parses_and_renders_end_to_end():
    raw = offline_coach("[00:01] Hanna: hi\n[00:02] Markus: hello")
    analysis = parse_analysis_json(raw)
    # all four technique dims present
    tech = analysis["sales_technique_analysis"]
    for dim in ["rapport_building", "discovery_quality", "pain_discovery", "value_communication"]:
        assert "score" in tech[dim]
        assert isinstance(tech[dim]["quotes"], list)
        assert "improvement_recommendation" in tech[dim]
    # 5 performance subs, 4 client subs
    assert set(analysis["performance_score"]) >= {
        "overall", "understanding_client_needs", "communication",
        "technical_explanation", "aggressiveness",
    }
    assert set(analysis["client_analysis"]) >= {"overall", "buying_intent", "interest", "communication"}
    assert analysis["strengths"] and analysis["weaknesses"]

    stats = {"transcript": "[00:01] Hanna: hi\n[00:02] Markus: hello", "wordCount": 4, "source": "readai"}
    row = build_row(analysis, stats, "Alex Hormozi", "2026-06-12")
    # speaker-derived AE/client (analysis has empty ae_name/client_contact)
    assert row.ae_name == "Hanna"
    assert row.persona == "Alex Hormozi"
    assert row.performance_score == 60
    assert row.client_buying_intent == 50
    # report renders without error
    report = build_report(analysis, row, "Alex Hormozi", [], stats)
    assert "Sales Coach Report" in report


def test_build_row_clean_columns_and_explicit_names():
    analysis = {
        "overall_summary": "Good call",
        "client_company": "Nordwind",
        "ae_name": "Hanna",
        "client_contact": "Markus",
        "sales_technique_analysis": {},
        "performance_score": {
            "overall": {"score": 65.4},
            "understanding_client_needs": {"score": 60},
            "communication": {"score": 75},
            "technical_explanation": {"score": 70},
            "aggressiveness": {"score": 40},
        },
        "client_analysis": {
            "overall": {"score": 55},
            "buying_intent": {"score": 50},
            "interest": {"score": 65},
            "communication": {"score": 70},
        },
        "strengths": [],
        "weaknesses": [],
    }
    row = build_row(analysis, {"transcript": "", "source": "erp"}, "Alex Hormozi", "2026-06-12")
    d = row.as_dict()
    # exact clean column set
    assert set(d) == {
        "client_name", "ae_name", "meeting_date", "summary", "strengths", "weaknesses",
        "performance_score", "understanding_client_needs", "communication",
        "technical_explanation", "aggressiveness", "client_score", "client_buying_intent",
        "client_interest", "client_communication", "persona", "source",
    }
    assert d["client_name"] == "Nordwind"  # explicit from analysis, not speaker-derived
    assert d["ae_name"] == "Hanna"
    assert d["performance_score"] == 65     # rounded
    assert d["source"] == "erp"


def test_build_row_derives_client_company_unknown():
    analysis = {
        "overall_summary": "",
        "sales_technique_analysis": {},
        "performance_score": {},
        "client_analysis": {},
    }
    row = build_row(analysis, {"transcript": "[00:01] Hanna: hi\n[00:02] Markus: yo"}, "Hormozi", "2026-06-12")
    assert row.client_name == "Unknown"
    assert row.ae_name == "Hanna"        # first speaker
    assert row.performance_score is None  # absent -> None

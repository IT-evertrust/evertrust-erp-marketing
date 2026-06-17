from datetime import date

from contractmaker.domain.company import company_key
from contractmaker.domain.contract import (
    build_fields, grounded, language_of, match_campaign, niche_match, template_name,
)
from contractmaker.readai import adapt

TODAY = date(2026, 6, 12)


def test_company_key_strips_legal_form_and_diacritics():
    assert company_key("Baltic Boxes Sp. z o.o.") == "balticboxes"
    assert company_key("Schöne Container GmbH") == "schonecontainer"


def test_niche_match():
    assert niche_match("Container", "container")
    assert niche_match("LED", "LED lighting")
    assert not niche_match("Container", "LED")
    assert not niche_match("", "Container")


def test_match_campaign_precedence():
    campaigns = [
        {"id": 1, "niche": "LED", "country": "Poland"},
        {"id": 2, "niche": "Container", "country": "Poland"},
        {"id": 3, "niche": "Container", "country": "Germany"},
    ]
    # country + niche wins
    assert match_campaign("Container", "Poland", campaigns)["id"] == 2
    # country only
    assert match_campaign("Painting", "Germany", campaigns)["id"] == 3
    # niche only
    assert match_campaign("LED", "France", campaigns)["id"] == 1
    # no match
    assert match_campaign("Painting", "France", campaigns) is None


def test_grounding_guard():
    hay = "we met baltic boxes sp. z o.o. at ul. prosta 5 warszawa".lower()
    assert grounded("Baltic Boxes", hay) == "Baltic Boxes"     # literal
    assert grounded("Warszawa", hay) == "Warszawa"
    assert grounded("Fabricated Holdings", hay) == ""          # not in transcript


def test_language_and_template_name():
    assert language_of("Germany") == "DE"
    assert language_of("Poland") == "EN"
    assert template_name("Container", "EN") == "Template_Container_EN"


def test_build_fields_grounded_vs_placeholder():
    agg = "Partner is Baltic Boxes Sp. z o.o., signatory Jan Kowalski, Managing Director."
    deal = {"companyName": "Baltic Boxes", "partnerLegalName": "Baltic Boxes Sp. z o.o.",
            "partnerSignatory": "Jan Kowalski", "partnerStreet": "Fake Street 999"}
    built = build_fields(deal, agg, "Container", "Poland", TODAY)
    f = built["fields"]
    assert f["CLIENT_NAME"] == "Baltic Boxes Sp. z o.o."   # grounded
    assert f["CLIENT_SIGNATORY"] == "Jan Kowalski"          # grounded
    assert f["CLIENT_STREET"] == "«Street»"                 # not in transcript -> placeholder
    assert f["COMMISSION_RATE"] == "3.5%"                   # hardcoded term
    assert built["template_name"] == "Template_Container_EN"
    assert "Baltic Boxes" in built["file_base"]


def test_readai_adapter():
    body = {"title": "Call", "summary": "S", "session_id": "x1",
            "transcript": {"speaker_blocks": [{"speaker": {"name": "A"}, "words": "hi"}]}}
    out = adapt(body)
    assert out["meeting_id"] == "x1" and "A: hi" in out["text"] and "# Summary" in out["text"]

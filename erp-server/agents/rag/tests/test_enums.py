from rag.domain.enums import (
    HANNA_ADDRESS,
    INFO_ADDRESS,
    UNSURE_AREAS,
    account_for,
    route_inbox,
)


def test_unsure_areas_closed_set():
    assert UNSURE_AREAS == {
        "Finance", "Operation", "Organization", "Legality",
        "Reference - Past Projects/Wins",
    }


def test_route_inbox_hanna_match():
    assert route_inbox("Hanna Nguyen") == HANNA_ADDRESS
    assert route_inbox("hanna@evertrust-germany.de") == HANNA_ADDRESS
    assert route_inbox("HANNA") == HANNA_ADDRESS


def test_route_inbox_defaults_to_info():
    assert route_inbox("") == INFO_ADDRESS
    assert route_inbox(None) == INFO_ADDRESS
    assert route_inbox("Trung Cang") == INFO_ADDRESS
    assert route_inbox("info@evertrust-germany.de") == INFO_ADDRESS


def test_account_for():
    assert account_for("Hanna") == "hanna"
    assert account_for("") == "info"
    assert account_for(None) == "info"

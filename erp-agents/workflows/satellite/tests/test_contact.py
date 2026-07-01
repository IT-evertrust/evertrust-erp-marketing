"""Impressum/Kontakt parser tests — real company name, named contact, phone (no I/O, no LLM).

Covers the three things the parser fixes for Lead Satellite: company-name = domain, empty contact,
generic-only emails. Plus the scrape_one integration that absorbs contact data off pages it already
fetches, and the leads_to_prospects mapping that carries the new fields to the ERP.
"""
from __future__ import annotations

from satellite.domain.contact import (
    ContactInfo,
    clean_phone,
    extract_contact_person,
    extract_legal_name,
    extract_phone,
    parse_contact,
)
from satellite.domain.models import Lead, leads_to_prospects
from satellite.domain.scrape import scrape_one

# A realistic German Impressum (the legally-mandated layout): legal name, managing director,
# phone + fax, mailto. This is the page scrape_one already downloads while hunting for an email.
IMPRESSUM = """
<html><body>
<h1>Impressum</h1>
<p>Müller LED-Systeme GmbH<br>
Industriestraße 14<br>
80331 München</p>
<p>Vertreten durch:<br>Geschäftsführer: Thomas Müller</p>
<p>Kontakt:<br>
Telefon: +49 89 123456-0<br>
Telefax: +49 89 123456-99<br>
E-Mail: <a href="mailto:t.mueller@mueller-led.de">t.mueller@mueller-led.de</a></p>
<p>Registergericht: Amtsgericht München<br>Registernummer: HRB 123456</p>
<p>Umsatzsteuer-ID: DE123456789</p>
</body></html>
"""


def test_extract_legal_name_basic():
    assert extract_legal_name(IMPRESSUM) == "Müller LED-Systeme GmbH"


def test_extract_legal_name_trims_heading():
    # The "Impressum" heading sits right before the name — it must be trimmed, not captured.
    html = "<h1>Impressum</h1> Schmidt Stahlbau GmbH &amp; Co. KG, Hafenstr. 3"
    assert extract_legal_name(html) == "Schmidt Stahlbau GmbH & Co. KG"


def test_extract_legal_name_ug_and_ek():
    assert extract_legal_name("<p>Beta Datentechnik UG (haftungsbeschränkt)</p>") == \
        "Beta Datentechnik UG (haftungsbeschränkt)"
    assert extract_legal_name("<p>Karl Weber e. K.</p>") == "Karl Weber e. K."


def test_extract_legal_name_none_for_non_dach():
    # No legal form, no Firma: label -> nothing (we never fabricate a name).
    assert extract_legal_name("<p>Just some marketing copy about LED panels.</p>") == ""


def test_extract_contact_person_strips_role_and_stops_at_field():
    assert extract_contact_person(IMPRESSUM) == "Thomas Müller"


def test_extract_contact_person_title_and_first_only_of_many():
    html = "<p>Geschäftsführer: Dr. Sabine Wendt, Thomas Müller</p>"
    assert extract_contact_person(html) == "Sabine Wendt"


def test_extract_contact_person_vertreten_durch():
    html = "<p>Vertreten durch den Inhaber Andreas Becker | Telefon: 030 1234567</p>"
    assert extract_contact_person(html) == "Andreas Becker"


def test_extract_contact_person_none_when_no_label():
    assert extract_contact_person("<p>Thomas Müller is our best customer.</p>") == ""


def test_clean_phone():
    assert clean_phone("+49 89 123456-0") == "+49891234560"
    assert clean_phone("(0) 30 / 12 34 56 7") == "0301234567"
    assert clean_phone("123") == ""           # too short
    assert clean_phone("abc") == ""


def test_extract_phone_prefers_tel_href_and_skips_fax():
    html = '<a href="tel:+493012345678">call</a> Telefax: +49 30 99999999'
    assert extract_phone(html) == "+493012345678"


def test_extract_phone_labelled_when_no_href():
    assert extract_phone(IMPRESSUM) == "+49891234560"   # the Telefon line, not the Telefax line


def test_parse_contact_full():
    info = parse_contact(IMPRESSUM)
    assert info == ContactInfo(
        company_name="Müller LED-Systeme GmbH",
        contact_name="Thomas Müller",
        phone="+49891234560",
    )
    assert parse_contact("") == ContactInfo()


# --- scrape_one integration ------------------------------------------------

class _Fetcher:
    """Returns canned HTML for a URL whose path contains a known key (substring match)."""
    def __init__(self, pages):
        self.pages = pages

    def get(self, url):
        for key, html in self.pages.items():
            if key in url:
                return html
        return ""


def test_scrape_one_recovers_name_contact_phone_and_email():
    # Homepage has no contact data; the Impressum (a guessed path) carries everything.
    lead = Lead(name="mueller-led.de", website="https://mueller-led.de", source_url="")
    fetcher = _Fetcher({"mueller-led.de/impressum": IMPRESSUM,
                        "mueller-led.de": "<html><body>Willkommen</body></html>"})
    ok = scrape_one(fetcher, lead)
    assert ok is True
    assert lead.email == "t.mueller@mueller-led.de"
    assert lead.contact_name == "Thomas Müller"
    assert lead.phone == "+49891234560"
    # the domain-placeholder name was upgraded to the real legal name
    assert lead.name == "Müller LED-Systeme GmbH"


def test_scrape_one_keeps_existing_real_name():
    # A real (non-domain) name must NOT be overwritten by the Impressum legal name.
    lead = Lead(name="Müller LED (DACH)", website="https://mueller-led.de")
    fetcher = _Fetcher({"impressum": IMPRESSUM})
    scrape_one(fetcher, lead)
    assert lead.name == "Müller LED (DACH)"
    assert lead.contact_name == "Thomas Müller"


def test_leads_to_prospects_carries_contact_fields():
    lead = Lead(name="Acme GmbH", email="info@acme.de", website="https://acme.de",
                contact_name="Jana Vogel", phone="+49301112223", status="")
    p = leads_to_prospects([lead])[0]
    assert p["contactName"] == "Jana Vogel"
    assert p["phone"] == "+49301112223"
    assert p["companyName"] == "Acme GmbH"

from satellite.emails import clean_email, decode_cf, harvest_emails


def test_decode_cf_roundtrip():
    # key 0x55, payload 'a@b.pl' XORed byte-by-byte
    assert decode_cf("553415377b2539") == "a@b.pl"


def test_decode_cf_rejects_garbage():
    assert decode_cf("") == ""
    assert decode_cf("abc") == ""        # odd length
    assert decode_cf("zzzz12") == ""     # not hex
    assert decode_cf("ff0102") == ""     # decodes to control chars < 9


def test_clean_email_strips_mailto_and_punctuation():
    assert clean_email("mailto:Info@Firma.pl?subject=x") == "Info@Firma.pl"
    assert clean_email('["biuro@x.pl",') == "biuro@x.pl"


def test_clean_email_bad_substrings():
    assert clean_email("noreply@x.pl") == ""
    assert clean_email("icon@2x.example.png") == ""
    assert clean_email("user@sentry.io") == ""
    assert clean_email("kontakt@mojeek.pl", extra_bad=("mojeek",)) == ""


def test_harvest_ranking_prefers_site_domain():
    html = (
        'mailto:random@gmail.com '
        '<a href="mailto:info@acme.pl">contact</a> '
        'jan.kowalski@acme.pl'
    )
    out = harvest_emails(html, "acme.pl")
    # both acme.pl addresses beat gmail; person-style beats generic within same domain
    assert out[0] == "jan.kowalski@acme.pl"
    assert out[1] == "info@acme.pl"
    assert out[2] == "random@gmail.com"


def test_harvest_decodes_cfemail():
    html = '<span data-cfemail="553415377b2539">[protected]</span>'
    assert harvest_emails(html, "b.pl") == ["a@b.pl"]


def test_harvest_caps_at_three():
    html = " ".join(f"user{i}@x.pl" for i in range(6))
    assert len(harvest_emails(html, "x.pl")) == 3

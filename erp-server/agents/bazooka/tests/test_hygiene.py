from bazooka.domain.hygiene import clean_email, is_valid_email


def test_unicode_hyphen_is_normalized():
    # U+2011 non-breaking hyphen — the original Gmail "Invalid email address" bug
    assert clean_email("biuro@dm‑system.pl") == "biuro@dm-system.pl"


def test_all_dash_variants_become_ascii():
    for dash in "‐‑‒–—―−﹘﹣－":
        assert clean_email(f"a{dash}b@x.pl") == "a-b@x.pl"


def test_invisible_chars_removed():
    assert clean_email("info@​asseco .pl ") == "info@asseco.pl"


def test_none_and_empty():
    assert clean_email(None) == ""
    assert not is_valid_email("")


def test_validity():
    assert is_valid_email("biuro@exon.pl")
    assert not is_valid_email("no-at-sign.pl")
    assert not is_valid_email("a@b")  # TLD must be >= 2 chars
    assert not is_valid_email("a b@c.pl")

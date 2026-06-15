from satellite.serp import _keep, normalize_domain, parse_serp

DDG_FIXTURE = """
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.acme%2Dsec.pl%2Foferta&amp;rut=abc">ACME Security - SOC i SIEM</a>
<a class="result__a other" href="https://plain-link.pl/page">Plain Link Sp. z o.o.</a>
<a class="result__a" href="https://www.facebook.com/acme">ACME on Facebook</a>
"""

MOJEEK_FIXTURE = """
<header>junk</header><!--rs-->
<h2><a class="title" href="https://firma-it.pl/uslugi">Firma IT - cyberbezpieczeństwo</a></h2>
<p class="s">Audyty bezpieczeństwa, testy penetracyjne dla firm.</p>
<!--rs-->
<h2><a class="title" href="https://hotel-spa.pl/">Hotel SPA Mazury</a></h2>
<p class="s">Wypoczynek nad jeziorem.</p>
"""

SEARXNG_FIXTURE = '{"results":[{"url":"https://soc24.pl/","title":"SOC24","content":"Security Operations Center as a service, monitoring 24/7"}]}'


def test_ddg_parse_decodes_uddg_redirect():
    out = parse_serp(DDG_FIXTURE, "ddg")
    assert out[0]["url"] == "https://www.acme-sec.pl/oferta"
    assert "ACME Security" in out[0]["title"]
    assert len(out) == 3


def test_mojeek_parse_blocks():
    out = parse_serp(MOJEEK_FIXTURE, "mojeek")
    assert len(out) == 2
    assert out[0]["url"] == "https://firma-it.pl/uslugi"
    assert "testy penetracyjne" in out[0]["snip"]


def test_searxng_parse_json():
    out = parse_serp(SEARXNG_FIXTURE, "searxng")
    assert out[0]["url"] == "https://soc24.pl/"
    assert out[0]["snip"].startswith("Security Operations")


def test_keep_filters_junk_and_niche_block():
    assert _keep({"url": "https://www.facebook.com/x", "title": "ok"}) == ""
    assert _keep({"url": "https://hotel-mazury.pl/", "title": "Hotel Mazury"}) == ""  # NICHE_BLOCK
    assert _keep({"url": "https://acme-sec.pl/about", "title": "ACME"}) == "acme-sec.pl"


def test_normalize_domain():
    assert normalize_domain("https://WWW.Acme.PL/path?q=1") == "acme.pl"

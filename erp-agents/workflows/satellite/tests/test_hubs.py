"""Tests for the GENERIC hub/directory expansion (satellite/domain/hubs.py)."""
from satellite.domain.hubs import harvest_company_links

HUB = "https://www.vdwbayern.de/wohnungsgenossenschaften/"

HTML = """
<html><body>
  <nav><a href="/impressum">Impressum</a> <a href="#top">top</a></nav>
  <ul class="members">
    <li><a href="https://www.gbg-augsburg.de/">GBG Augsburg Wohnbaugruppe</a></li>
    <li><a href="https://wsb-bamberg.de/start">WSB Bamberg eG</a></li>
    <li><a href="https://www.gbg-augsburg.de/kontakt">GBG again (dupe domain)</a></li>
  </ul>
  <footer>
    <a href="https://www.facebook.com/vdwbayern">Facebook</a>
    <a href="https://www.vdwbayern.de/kontakt">Kontakt</a>
    <a href="https://muenchen.gov.de/">Stadt</a>
  </footer>
</body></html>
"""


def test_harvest_extracts_member_company_domains_with_names():
    links = harvest_company_links(HTML, HUB)
    by_dom = dict(links)
    assert "gbg-augsburg.de" in by_dom
    assert "wsb-bamberg.de" in by_dom
    assert by_dom["gbg-augsburg.de"] == "GBG Augsburg Wohnbaugruppe"  # anchor text = member name


def test_harvest_dedupes_by_domain_first_wins():
    links = harvest_company_links(HTML, HUB)
    doms = [d for d, _ in links]
    assert doms.count("gbg-augsburg.de") == 1


def test_harvest_excludes_hub_self_social_and_gov():
    doms = {d for d, _ in harvest_company_links(HTML, HUB)}
    assert "vdwbayern.de" not in doms          # the hub itself
    assert "facebook.com" not in doms          # social junk
    assert not any("gov" in d for d in doms)   # government


def test_harvest_skips_relative_links():
    doms = {d for d, _ in harvest_company_links(HTML, HUB)}
    # /impressum and #top are in-site/relative -> never become candidate domains
    assert all("." in d for d in doms)


def test_harvest_cap_limits_results():
    many = "".join(f'<a href="https://co{i}.de/">Co {i}</a>' for i in range(50))
    assert len(harvest_company_links(f"<ul>{many}</ul>", HUB, cap=10)) == 10


def test_empty_html_is_safe():
    assert harvest_company_links("", HUB) == []
    assert harvest_company_links(None, HUB) == []


# --- integration: the driver's hub stage uses the renderer when static HTML is thin -------------
import _run_niche


class _FakeFetcher:
    def __init__(self, html):
        self._html = html

    def get(self, url):
        return self._html


class _FakeRenderer:
    def __init__(self, html):
        self._html = html
        self.calls = 0

    def render(self, url):
        self.calls += 1
        return self._html


def _buckets_with_hub():
    hub = {"website": "https://hub.example/members", "entity": "association", "nicheFit": "core"}
    return {"source_ref": [hub], "contacts": [], "generic": [],
            "qualified_no_email": [], "rejected": []}


def test_render_fallback_harvests_js_only_members():
    thin = '<a href="/internal">nav</a>'                 # no external company links statically
    rich = ('<a href="https://memberco-a.de/">Member A eG</a>'
            '<a href="https://memberco-b.de/">Member B eG</a>')
    rend = _FakeRenderer(rich)
    leads = _run_niche.expand_via_hubs(_buckets_with_hub(), _FakeFetcher(thin), set(),
                                       country="Germany", renderer=rend)
    assert rend.calls == 1                               # render fallback fired (static was thin)
    assert sorted(l.website for l in leads) == ["https://memberco-a.de", "https://memberco-b.de"]


def test_no_render_when_static_is_rich_enough():
    rich_static = "".join(f'<a href="https://co{i}.de/">Co {i}</a>' for i in range(8))
    rend = _FakeRenderer("<a href='https://should-not-be-used.de/'>x</a>")
    leads = _run_niche.expand_via_hubs(_buckets_with_hub(), _FakeFetcher(rich_static), set(),
                                       country="Germany", renderer=rend)
    assert rend.calls == 0                               # static had enough -> renderer untouched
    assert len(leads) == 8


def test_css_logo_anchor_name_falls_back_to_domain():
    # An <a> wrapping an inline SVG logo: its text is CSS, not a company name -> use the domain.
    html = ('<a href="https://memberco.de/">'
            '<svg><style>.cls-1 { fill: #1f82c0; } .poly { isolation: isolate; }</style></svg>'
            '</a>')
    links = dict(harvest_company_links(html, "https://hub.de/"))
    assert links["memberco.de"] == "memberco.de"   # not the CSS text

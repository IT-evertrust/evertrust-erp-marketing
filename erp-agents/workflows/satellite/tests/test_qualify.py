"""qualify stage tests — crawl (faked) -> entity/niche/geo -> tier -> buckets."""
from satellite.qualify import qualify, CONTACTS, GENERIC, QUALIFIED_NO_EMAIL, REJECTED, SOURCE_REF
from satellite.domain.icp import build_icp, AAA, AA, A


class FakeFetcher:
    """Returns canned HTML for any URL whose path contains a known key (substring match)."""
    def __init__(self, pages):
        self.pages = pages

    def get(self, url):
        for key, html in self.pages.items():
            if key in url:
                return html
        return ""


def _icp():
    # ICP built from AIM-style niche keywords (no hardcoded niche table)
    return build_icp("Cybersecurity", "Germany",
                     buzz=["pentest", "penetrationstest", "siem", "firewall", "incident response",
                           "managed security", "informationssicherheit"])


def test_qualify_buckets():
    pages = {
        "acme-sec.de": "<p>Wir bieten Pentest, SIEM, Managed Security und Incident Response.</p>",
        "systemhaus.de": "<p>IT-Systemhaus: managed IT, Netzwerk und eine Firewall.</p>",
        "shoes.de": "<h1>Schuhe und Mode</h1><p>Wir verkaufen Schuhe.</p>",
    }
    prospects = [
        {"companyName": "ACME Security GmbH", "website": "https://acme-sec.de",
         "email": "anna.weber@acme-sec.de"},                       # core + personal email
        {"companyName": "XY Systemhaus GmbH", "website": "https://systemhaus.de",
         "email": "info@systemhaus.de"},                           # related + generic email
        {"companyName": "Schuh GmbH", "website": "https://shoes.de",
         "email": "info@shoes.de"},                                # company, off-niche
        {"companyName": "CyberForum e.V.", "website": "https://cyberforum.de",
         "email": "info@cyberforum.de"},                           # association -> source/ref
        {"companyName": "Bezpiek Sp. z o.o.", "website": "https://bezpiek.pl",
         "email": "biuro@bezpiek.pl"},                             # foreign ccTLD -> out of geo
    ]
    out = qualify(prospects, FakeFetcher(pages), _icp(), country="Germany", market_tld=".de")

    # tier now follows the 15:23 score logic (email + on-niche + market TLD); buckets unchanged
    assert prospects[0]["tier"] in (AAA, AA, A) and prospects[0] in out[CONTACTS]
    assert prospects[1]["tier"] in (AAA, AA, A) and prospects[1] in out[GENERIC]
    assert prospects[2] in out[REJECTED] and prospects[2]["tierReason"] == "off-niche"
    assert prospects[3] in out[SOURCE_REF]
    assert prospects[4] in out[REJECTED] and prospects[4]["tierReason"] == "out-of-geo"


def test_qualify_with_llm_classifier_polish():
    # The LLM classifier reads the PAGE (Polish here) — NO hardcoded German/Polish word lists needed.
    def fake_clf(name, url, text):
        t = text.lower()
        if "fundacja" in t or "stowarzyszenie" in t:
            return {"entityType": "association", "nicheFit": "core"}
        if "oświetlenie led" in t or "oprawy led" in t:
            return {"entityType": "company", "nicheFit": "core"}
        if "buty" in t or "sklep z butami" in t:
            return {"entityType": "company", "nicheFit": "none"}
        return {"entityType": "company", "nicheFit": "peripheral"}

    pages = {
        "ledpro.pl": "<p>Producent: oświetlenie LED, oprawy LED dla przemysłu.</p>",
        "fund.pl": "<p>Fundacja na rzecz oświetlenia miast.</p>",
        "buty.pl": "<p>Sklep z butami i modą.</p>",
    }
    icp = build_icp("LED", "Poland", buzz=["oświetlenie led", "oprawy led", "panele led"])
    prospects = [
        {"companyName": "LEDPro Sp. z o.o.", "website": "https://ledpro.pl", "email": "info@ledpro.pl"},
        {"companyName": "Fundacja Światło", "website": "https://fund.pl", "email": "kontakt@fund.pl"},
        {"companyName": "Buty S.A.", "website": "https://buty.pl", "email": "sklep@buty.pl"},
    ]
    out = qualify(prospects, FakeFetcher(pages), icp, country="Poland", market_tld=".pl",
                  classifier=fake_clf)
    assert prospects[0]["tier"] == AAA and prospects[0] in out[GENERIC]   # core, generic info@
    assert prospects[1] in out[SOURCE_REF]                                 # association (LLM, Polish)
    assert prospects[2] in out[REJECTED] and prospects[2]["tierReason"] == "llm:off-niche"


def test_qualify_no_email_bucket():
    pages = {"sec.de": "<p>Penetrationstest, SIEM, Informationssicherheit, Incident Response</p>"}
    prospects = [{"companyName": "Sec GmbH", "website": "https://sec.de", "email": ""}]
    out = qualify(prospects, FakeFetcher(pages), _icp(), country="Germany", market_tld=".de")
    assert prospects[0] in out[QUALIFIED_NO_EMAIL]      # qualified niche, but no email -> its own bucket
    assert prospects[0]["tier"] in (AAA, AA, A, "B")    # scored (no email lowers it), still qualified

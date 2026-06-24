"""ICP qualify/tier tests — grounded in the real critique examples from the qwen2.5 run."""
from satellite.domain import icp
from satellite.domain.icp import (
    CYBERSECURITY as CY, classify_entity, niche_fit, niche_signals, build_icp, assign_tier,
    email_status, COMPANY, EVENT, ASSOCIATION, GOV, EDU, TRAINING, DIRECTORY, JOBBOARD, NEWS,
    AAA, AA, A, B, EXCLUDE, VERIFIED, GENERIC, GUESSED, NO_EMAIL, PUBLIC_FOUND,
)


# ---- entity classifier: the rows the critique said must NOT be company leads ----
def test_entity_non_companies():
    assert classify_entity("PC-COLLEGE IT Security Schulungen", url="https://security.pc-college.de") == TRAINING
    assert classify_entity("Cyberwehr", "Eine Initiative des Landes BW", "https://cyberwehr-bw.de") == ASSOCIATION
    assert classify_entity("CyberForum e.V.", "Hightech-Unternehmernetzwerk", "https://cyberforum.de") == ASSOCIATION
    assert classify_entity("Tag der IT-Sicherheit", "Veranstaltung in Karlsruhe", "https://tag-der-it-sicherheit.de") == EVENT
    assert classify_entity("Generalstaatsanwaltschaft Karlsruhe", url="https://generalstaatsanwaltschaft-karlsruhe.justiz-bw.de") == GOV
    assert classify_entity("BSI", "Allianz für Cyber-Sicherheit", "https://bsi.bund.de") == GOV
    assert classify_entity("Cyber Security B.Sc. - Hochschule Mannheim", url="https://informatik.hs-mannheim.de") == EDU
    assert classify_entity("Das Örtliche", url="https://dasoertliche.de") == DIRECTORY
    assert classify_entity("wlw", url="https://wlw.de") == DIRECTORY
    assert classify_entity("Security jobs", url="https://stepstone.de/jobs") == JOBBOARD


def test_entity_real_companies():
    # legal form present -> a company even if the page name-drops "security"/"forum"/"academy"
    assert classify_entity("EnBW Cyber Security GmbH", url="https://enbw.com") == COMPANY
    assert classify_entity("secorvo Security Consulting GmbH", url="https://secorvo.de") == COMPANY
    assert classify_entity("aramido GmbH", "Pentest & IT-Security", "https://aramido.de") == COMPANY
    assert classify_entity("ProSec GmbH", "Penetration Testing", "https://prosec-networks.com") == COMPANY


# ---- niche fit: core vs peripheral vs the generic-'Sicherheit' physical-security noise ----
def test_niche_fit_core():
    assert niche_fit("Wir bieten Pentest, SOC und Incident Response. ISO 27001 ISMS.", CY) == "core"
    assert niche_fit("MSSP managed security operations center, threat hunting", CY) == "core"


def test_niche_fit_peripheral_and_noise():
    assert niche_fit("IT-Systemhaus, managed IT, Netzwerktechnik, Cloud, eine Firewall", CY) == "peripheral"
    # physical security / guards / disaster relief: only the generic stem -> incidental (NOT a lead)
    assert niche_fit("Sicherheitsdienst und Werkschutz für Objektschutz", CY) == "incidental"
    # disaster relief: at most the generic 'schutz' stem -> never core/peripheral (both -> EXCLUDE)
    assert niche_fit("Katastrophenschutz und Bevölkerungsschutz", CY) in ("none", "incidental")
    assert niche_fit("Wir verkaufen Schuhe", CY) == "none"


# ---- tier assignment: the spec's ordered gates ----
def test_tier_excludes_non_company_and_off_niche():
    assert assign_tier(entity=TRAINING, core_hits=5, icp=CY)[0] == EXCLUDE          # PC-COLLEGE
    assert assign_tier(entity=ASSOCIATION, core_hits=5, icp=CY)[0] == EXCLUDE       # Cyberwehr/CyberForum
    assert assign_tier(entity=GOV, core_hits=5, icp=CY)[0] == EXCLUDE              # BSI/Staatsanwaltschaft
    # a real company we DID read, with no niche evidence -> off-niche EXCLUDE (e.g. physical security)
    assert assign_tier(entity=COMPANY, core_hits=0, evidence_ok=True, icp=CY)[0] == EXCLUDE
    assert assign_tier(entity=COMPANY, core_hits=3, in_geo=False, icp=CY)[0] == EXCLUDE


def test_tier_revenue_free_depth():
    # default (revenue parked): tier by depth of niche evidence
    assert assign_tier(entity=COMPANY, core_hits=4, icp=CY)[0] == AAA   # >= core_min_hits + 2
    assert assign_tier(entity=COMPANY, core_hits=2, icp=CY)[0] == AA    # >= core_min_hits
    assert assign_tier(entity=COMPANY, core_hits=1, icp=CY)[0] == A     # one marker = related
    assert assign_tier(entity=COMPANY, peri_hits=1, icp=CY)[0] == A
    # couldn't crawl (no evidence yet) but it IS a company -> keep for manual as B, not EXCLUDE
    assert assign_tier(entity=COMPANY, core_hits=0, evidence_ok=False, icp=CY)[0] == B


def test_tier_revenue_path_still_available():
    # parked spec gate still works when explicitly enabled
    kw = dict(use_revenue=True, revenue_verified=True, icp=CY)
    assert assign_tier(entity=COMPANY, core_hits=3, revenue_eur=25e6, **kw)[0] == AAA
    assert assign_tier(entity=COMPANY, core_hits=3, revenue_eur=15e6, **kw)[0] == AA
    assert assign_tier(entity=COMPANY, core_hits=3, revenue_eur=5e6, **kw)[0] == EXCLUDE
    assert assign_tier(entity=COMPANY, core_hits=1, revenue_eur=14e6, **kw)[0] == A
    assert assign_tier(entity=COMPANY, core_hits=3, use_revenue=True, icp=CY)[0] == B   # rev unknown


def test_build_icp_dynamic_from_aim():
    # ICP markers come from AIM's own niche keywords (profiler), NOT a hardcoded table
    prof = {"keywordsLocal": ["Netzwerksicherheit", "Penetrationstest"],
            "keywordsEnglish": ["network security", "pentest"]}
    dyn = build_icp("Cybersecurity", "Germany", profile=prof)
    assert "netzwerksicherheit" in dyn.core_terms and "pentest" in dyn.core_terms
    assert niche_fit("Wir bieten Netzwerksicherheit und Penetrationstest an", dyn) == "core"
    # a DIFFERENT niche yields DIFFERENT markers — fully general, AIM drives it
    solar = build_icp("Solar", "Poland", buzz=["fotowoltaika", "panele słoneczne", "photovoltaik"])
    assert "fotowoltaika" in solar.core_terms
    assert niche_fit("Sicherheitsdienst und Werkschutz", solar) == "none"


# ---- email confidence ladder ----
def test_email_status():
    assert email_status("") == NO_EMAIL
    assert email_status("info@acme.de") == GENERIC
    assert email_status("anna.weber@acme.de", source="impressum") == PUBLIC_FOUND
    assert email_status("anna.weber@acme.de", source="guessed") == GUESSED
    assert email_status("anna.weber@acme.de", mx_ok=True) == VERIFIED
    assert email_status("info@acme.de", mx_ok=True) == GENERIC          # generic stays generic
    assert email_status("anna.weber@acme.de", catch_all=True) == icp.ACCEPT_ALL

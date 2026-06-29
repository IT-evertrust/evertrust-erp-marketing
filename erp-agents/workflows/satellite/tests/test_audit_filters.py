"""Bad-email filter hardened from the 2026-06-26 lead audit (language-agnostic: placeholders,
scraping artifacts, third-party addresses). Off-niche / non-company / physical-vs-cyber are NOT
keyword-blocked here — that is the LLM classifier's job (multi-country), see clients/llm.classify_company."""
from satellite.domain.models import is_bad_email


def test_bad_emails_rejected():
    bad = [
        "mustermann@gmail.com",            # KIT-Gründerschmiede placeholder
        "Max.Mustermann@itdz-berlin.de",   # ITDZ — placeholder even on the real domain
        "ihre@email.de",                   # Cybernotfall24 placeholder
        "dpo-google@google.com",           # Cyber24Security — third-party, not the company's
        "%20info@dorsch-informationssicherheit.de",   # URL-encoding artifact
        "u003eprivacy@personio.com",       # JS unicode-escape artifact
        "app.bundle@scaltel.js",           # SCALTEL — a JS filename, not an address
        "info@beispiel.de", "MaraMuster@mail.de",
    ]
    for e in bad:
        assert is_bad_email(e), f"should be bad: {e}"


def test_real_emails_pass():
    good = ["info@scaltel.de", "post@itdz-berlin.de", "info-itsecurity@axians.de",
            "kontakt@reith-it.de", "info@securepoint.de"]
    for e in good:
        assert not is_bad_email(e), f"should be ok: {e}"

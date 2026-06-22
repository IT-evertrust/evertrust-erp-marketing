"""Locale layer for Lead Satellite — geography enters ONLY here.

Targeting is driven by the AIM config (niche / region / country). This module maps
the AIM's `country` to a LocaleProfile: the language to search in, the conventional
contact/imprint page paths + link labels to look for when scraping, and the
connective words for query templates. Unknown countries fall back to a generic
English profile, so any AIM works on day one — known countries just work better.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class LocaleProfile:
    language: str  # ISO-639-1, informational + for prompts
    # Connective words used to build search queries (kept locale-native so we match
    # local SMEs, which rarely rank for English terms).
    kw_company: str  # "companies" / "Unternehmen" / "entreprises"
    kw_contact: str  # "contact" / "Kontakt" / "contact"
    kw_supplier: str  # "supplier" / "Anbieter" / "fournisseur"
    # Paths probed directly on a domain to find the contact/imprint page.
    contact_paths: tuple[str, ...]
    # Anchor-text substrings (lowercased) that indicate a contact/imprint link.
    contact_link_labels: tuple[str, ...]
    # B2B directory hosts to bias discovery toward (used as site: filters). Optional.
    directories: tuple[str, ...] = field(default_factory=tuple)


# Generic English default — used for any country not explicitly tabled below.
_GENERIC = LocaleProfile(
    language="en",
    kw_company="companies",
    kw_contact="contact",
    kw_supplier="supplier",
    contact_paths=("/contact", "/contact-us", "/about", "/about-us", "/imprint", "/legal"),
    contact_link_labels=("contact", "about", "imprint", "legal", "impressum"),
    directories=("europages.com", "kompass.com"),
)

# country (lowercased) -> profile. Add markets here; everything else gets _GENERIC.
_PROFILES: dict[str, LocaleProfile] = {
    "germany": LocaleProfile(
        language="de",
        kw_company="Unternehmen",
        kw_contact="Kontakt",
        kw_supplier="Anbieter",
        contact_paths=("/impressum", "/kontakt", "/impressum.html", "/kontakt.html", "/contact"),
        contact_link_labels=("impressum", "kontakt", "contact"),
        directories=("wlw.de", "gelbeseiten.de", "11880.com", "europages.de"),
    ),
    "austria": LocaleProfile(
        language="de",
        kw_company="Unternehmen",
        kw_contact="Kontakt",
        kw_supplier="Anbieter",
        contact_paths=("/impressum", "/kontakt", "/contact"),
        contact_link_labels=("impressum", "kontakt", "contact"),
        directories=("herold.at", "europages.at"),
    ),
    "switzerland": LocaleProfile(
        language="de",
        kw_company="Unternehmen",
        kw_contact="Kontakt",
        kw_supplier="Anbieter",
        contact_paths=("/impressum", "/kontakt", "/contact", "/mentions-legales"),
        contact_link_labels=("impressum", "kontakt", "contact", "mentions"),
        directories=("local.ch", "europages.ch"),
    ),
    "france": LocaleProfile(
        language="fr",
        kw_company="entreprises",
        kw_contact="contact",
        kw_supplier="fournisseur",
        contact_paths=("/contact", "/mentions-legales", "/a-propos", "/nous-contacter"),
        contact_link_labels=("contact", "mentions", "propos", "legal"),
        directories=("pagesjaunes.fr", "europages.fr", "kompass.com"),
    ),
    "united kingdom": LocaleProfile(
        language="en",
        kw_company="companies",
        kw_contact="contact",
        kw_supplier="supplier",
        contact_paths=("/contact", "/contact-us", "/about", "/about-us"),
        contact_link_labels=("contact", "about"),
        directories=("yell.com", "europages.co.uk"),
    ),
    "united states": LocaleProfile(
        language="en",
        kw_company="companies",
        kw_contact="contact",
        kw_supplier="supplier",
        contact_paths=("/contact", "/contact-us", "/about", "/about-us"),
        contact_link_labels=("contact", "about"),
        directories=("yellowpages.com", "thomasnet.com"),
    ),
}

# Common aliases so the AIM's free-text country still resolves.
_ALIASES = {
    "deutschland": "germany",
    "de": "germany",
    "österreich": "austria",
    "at": "austria",
    "schweiz": "switzerland",
    "ch": "switzerland",
    "fr": "france",
    "uk": "united kingdom",
    "great britain": "united kingdom",
    "england": "united kingdom",
    "usa": "united states",
    "us": "united states",
    "united states of america": "united states",
}


def profile_for(country: str | None) -> LocaleProfile:
    """Resolve an AIM country (free text) to a LocaleProfile, falling back to generic."""
    if not country:
        return _GENERIC
    key = country.strip().lower()
    key = _ALIASES.get(key, key)
    return _PROFILES.get(key, _GENERIC)

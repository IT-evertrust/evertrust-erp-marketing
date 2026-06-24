"""Commercial-only + niche-relevance gates for discovery (port of the n8n JUNK / NICHE_BLOCK +
niche-keyword check). Pure, no I/O — fed (name + snippet + website) of each candidate.

Two gates, applied in pipeline discovery AFTER hit_to_lead's host filter:
  - is_blocked(): drop non-commercial / off-target results — universities, schools, training,
    job boards, directories/aggregators, gov, events. (Was the n8n NICHE_BLOCK.)
  - mentions_niche(): keep only results whose text actually mentions the niche, matched
    BILINGUALLY via word roots (so 'cyber' hits both 'cybersecurity' and 'cyberbezpieczeństwo').
"""
from __future__ import annotations

import re

# Substrings that mark a result as non-commercial / off-target. Curated to target the noise the
# satellite actually pulls (universities, courses, job boards, directories, events) while avoiding
# obvious false positives on real company text (e.g. 'studia' not 'studi', so 'studio' is safe).
NICHE_BLOCK = (
    # education / research / training
    "uczelni", "studia", "podyplomow", "uniwersyt", "universit", "politechnik", "hochschule",
    "akademia", "instytut", "fundacj", "stowarzysz", "szkolenia", "szkolenie", "bootcamp",
    "edu.pl", ".edu/", "kursy ",
    # events / conferences
    "konferencj", "konferenz", "seminarium", "webinar", " targi", "warsawexpo", "expo.",
    # job boards / recruitment
    "pracuj.pl", "nofluffjobs", "justjoin", "bulldogjob", "rocketjobs", "crossweb", "jooble",
    "indeed.", "glassdoor", "useme.", "rekrutacj", "/praca", "praca.pl",
    # directories / aggregators / rankings (noise as a LEAD — later useful as a SOURCE to mine)
    "panoramafirm", "pkt.pl", "aleo.", "europages", "kompass.", "clutch.co", "goodfirms",
    "sortlist", "designrush", "edurank", "otouczelnie", "oferteo", "ranking",
    "techbehemoths", "themanifest", "f6s.com", "ensun.", "crunchbase", "superbcompanies",
    # generic tech-reference / Q&A / tutorials — never a B2B lead
    "stackoverflow", "geeksforgeeks", "tutorialspoint", "w3schools", "virustotal", "caclubindia",
    # gov / reference
    "gov.pl", ".gov/", "wikipedia",
    # --- multilingual / generic noise (added 2026-06-19, post Slovakia AI-Platform test) ---
    # news / media: a newspaper / portal / magazine is a SOURCE, never a lead. (domain-anchored
    # forms like 'aktuality.'/'news.' to avoid blocking a company's own 'News' section)
    "noviny", "vecernik", "večerník", "denník", "dennik", "aktuality.", "zeitung", "nachrichten",
    "tageblatt", "wochenblatt", "wiadomosci", "gazeta", "redakc", "/news", "news.", "blog.", "magazín",
    # courses / training (Slavic/Romance/Hungarian/Dutch — avoid bare 'kurz' which hits German 'kurzfristig')
    "kurzy", "kurzov", "kursy", "skolenia", "školenia", "vzdeláv", "vzdelav", "cursos", "képzés", "opleiding",
    # government / public sector / academia (any country): TLDs + bodies
    ".gov", "gov.", ".edu", "edu.", "ministerstvo", "ministerium", "ministry of", "portalvs",
    "vysoká škola", "vysoka skola", "univerz", "akadémia", "samospr",
    # associations / NGOs / federations (a 'lead' is a commercial vendor, not an association)
    "asociác", "asociac", "združenie", "zdruzenie", "koalíci", "koalici", "spolok", "verband",
    # --- English-language noise (added 2026-06-19 after the mini-8B Slovakia run) ---
    # training / courses / certification / tutorials / reference (a learner page is not a lead)
    "certification", "certif training", "online training", "training course", "e-learning",
    "elearning", "tutorial", "udemy", "coursera", "kodekloud", "ml-ops.org", "what is ",
    "complete guide", "beginner's guide", "/learn", "academy.",
    # quizzes / games / entertainment
    "quiz", "poki.", "/games", "play now", "gaming",
    # review / comparison / software directories & aggregators (sources, not leads)
    "softwaresuggest", "g2.com", "capterra", "getapp", "softwareadvice", "trustradius",
    "saasworthy", "slashdot", "producthunt", "datacentermap",
    # news / blogs / tech media (English) + the job board & directory flagged earlier
    "mspoweruser", "techcrunch", "thenextweb", "venturebeat", "/blog/", "blog.", "wyborcza",
    "gowork", "firmania",
)


def is_blocked(text: str) -> bool:
    low = (text or "").lower()
    return any(w in low for w in NICHE_BLOCK)


# Word runs across ALL scripts (Latin, Cyrillic, Greek, …) — '\w' minus '_'. This lets local
# buzzwords (e.g. Bulgarian 'киберсигурност') become match-tokens, so the niche gate is bilingual.
_WORD = re.compile(r"[^\W_]+")


def niche_tokens(niche: str, buzzwords=None) -> list[str]:
    """Build the niche match-tokens from the niche phrase + buzzwords (which include the country's
    LOCAL-language keywords from the profiler). Long words also contribute a 5-char ROOT so matching
    works across languages: 'cybersecurity' -> 'cyber', Bulgarian 'киберсигурност' -> 'кибер',
    'penetration' -> 'penet' (hits Polish 'penetracyjne')."""
    out, seen = [], set()
    for phrase in [niche or ""] + list(buzzwords or []):
        for w in _WORD.findall(str(phrase).lower()):
            if len(w) >= 3 and w not in seen:
                seen.add(w)
                out.append(w)
            if len(w) >= 7:
                root = w[:5]
                if root not in seen:
                    seen.add(root)
                    out.append(root)
    return out


# Ultra-generic IT/web vocabulary (+ their 5-char roots) that appears on a huge slice of the
# web. These must NOT, on their own, qualify a page as on-niche — otherwise broad niches like
# "Cloud Infrastructure" (buzzwords: server/online/platform/compute/network) let chess.com,
# lichess, video sites etc. pass the gate. A page must match a DISTINCTIVE niche term
# (e.g. "cloud", "infrastructure", "hosting", "cyber") to count. Niche-specific words are
# deliberately absent here, so distinctive vocab still gates normally.
GENERIC_GATE_TOKENS = frozenset({
    "online", "onlin", "server", "servers", "platform", "platf", "technology", "techn",
    "technologies", "digital", "digit", "internet", "intern", "web", "app", "apps",
    "application", "appli", "software", "softw", "system", "systems", "syste", "solution",
    "solutions", "solut", "service", "services", "servi", "data", "network", "networks",
    "netwo", "compute", "computer", "computers", "computing", "compu", "tech", "comp",
    "company", "compa", "business", "busin", "provider", "provi", "global", "group",
})


def mentions_niche(text: str, tokens) -> bool:
    """True if the text mentions the niche via a DISTINCTIVE token. Generic IT/web tokens
    (GENERIC_GATE_TOKENS) are ignored so they can't alone qualify off-niche pages. Short
    tokens (<=4, e.g. 'led') require a word-boundary match; longer tokens match as substrings.
    If every token is generic (degenerate niche), fall back to all tokens to avoid over-filtering."""
    if not tokens:
        return True
    distinctive = [t for t in tokens if t not in GENERIC_GATE_TOKENS]
    use = distinctive or list(tokens)
    low = (text or "").lower()
    for tok in use:
        if len(tok) <= 4:
            if re.search(r"\b" + re.escape(tok) + r"\b", low):
                return True
        elif tok in low:
            return True
    return False

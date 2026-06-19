"""Commercial-only (NICHE_BLOCK) + bilingual niche-relevance gates."""
from __future__ import annotations

from satellite.domain.filters import is_blocked, mentions_niche, niche_tokens


def test_blocked_drops_education_jobs_directories():
    assert is_blocked("Cyberbezpieczeństwo - Politechnika Warszawska https://pw.edu.pl")
    assert is_blocked("Cybersecurity jobs https://nofluffjobs.com")
    assert is_blocked("Warsaw's 10 best Cyber Security universities https://edurank.org")
    assert not is_blocked("Penetration Testing | stmcyber.pl Warszawa")


def test_niche_gate_is_bilingual():
    toks = niche_tokens("Cybersecurity", ["cyberbezpieczeństwo", "testy penetracyjne"])
    assert mentions_niche("Testy penetracyjne i cyberbezpieczeństwo dla firm", toks)
    assert mentions_niche("Cybersecurity services in Warsaw", toks)
    assert not mentions_niche("Best point and shoot cameras 2026 guide", toks)


def test_niche_gate_short_token_word_boundary():
    toks = niche_tokens("LED", [])
    assert mentions_niche("LED Beleuchtung GmbH Berlin", toks)
    assert not mentions_niche("Knowledge scheduled module", toks)   # 'led' not a standalone word


def test_niche_tokens_bilingual_cyrillic():
    # Local-language buzzwords (Cyrillic) must become match-tokens so native-named firms pass.
    toks = niche_tokens("Cybersecurity", ["киберсигурност", "информационна сигурност"])
    assert "киберсигурност" in toks
    assert mentions_niche("Фирма за киберсигурност в София", toks)
    assert mentions_niche("Cybersecurity company in Sofia", toks)
    assert not mentions_niche("Магазин за цветя", toks)   # flower shop -> dropped

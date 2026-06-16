from __future__ import annotations

from crm.domain.models import Campaign, compute_rows, norm_company, signed_keys_from


def test_norm_company():
    assert norm_company("ACME Sp. z o.o.") == "acme"
    assert norm_company("Beta GmbH") == "beta"
    # matches the n8n JS norm: ł is not NFD-decomposable, so it's dropped (not folded to l)
    assert norm_company("Wrocław Tech") == "wrocawtech"


def test_signed_keys_from():
    keys = signed_keys_from([{"companyName": "Beta GmbH"}, {"company_key": "Acme"}])
    assert keys == {"beta", "acme"}


def test_compute_intake_and_graduation():
    camp = Campaign(
        campaign_id="c1", campaign_name="POLAND", niche="LED",
        prospects=[
            {"id": "p1", "email": "interested@a.de", "companyName": "Acme", "status": "Interested"},
            {"id": "p2", "email": "meeting@b.de", "companyName": "Beta GmbH", "status": "Meeting Scheduled"},
            {"id": "p3", "email": "new@c.de", "companyName": "C", "status": "NEW"},
            {"id": "p4", "email": "existing@cust.de", "companyName": "Signed Co", "status": "Meeting"},
        ],
        signed_keys={"beta", "signedco"},
    )
    rows = compute_rows([camp], customer_emails={"existing@cust.de"}, now_iso="2026-06-15T00:00:00Z")
    hot = [r for r in rows if r["_t"] == "hot"]
    cust = [r for r in rows if r["_t"] == "cust"]
    assert len(hot) == 3                       # p1, p2, p4 (p3 NEW skipped)
    assert len(cust) == 1                       # p2 signed + not already a customer
    assert cust[0]["email"] == "meeting@b.de"
    # p4 is signed but already a customer -> hot only, no graduation
    p4 = next(r for r in hot if r["email"] == "existing@cust.de")
    assert p4["hotReason"] == "Signed"
    assert next(r for r in hot if r["email"] == "interested@a.de")["hotReason"] == "Interested"

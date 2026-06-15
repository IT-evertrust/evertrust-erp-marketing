from bazooka.clients.llm import offline_fill
from bazooka.domain.models import Campaign, Prospect, Template


def test_fills_both_placeholder_casings():
    camp = Campaign(id="c1", project="POLAND CONTAINER 2026", region="Warszawa", niche="LED")
    p = Prospect(id="p1", email="a@b.com", company_name="LEDCity", city="Stróże")
    t = Template("{{companyName}} — offer", "Hi {{Company Name}} in {{city}} re {{project}}")
    v = offline_fill(p, camp, t, "a@b.com")
    assert v.valid
    assert v.final_subject == "LEDCity — offer"
    assert "LEDCity" in v.final_body
    assert "Stróże" in v.final_body
    assert "POLAND CONTAINER 2026" in v.final_body

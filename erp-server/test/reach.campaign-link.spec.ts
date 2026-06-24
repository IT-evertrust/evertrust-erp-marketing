import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { ReachRepository } from '../src/reach/reach.repository';
import { getDb } from './real-db';

// WHY: a Reach aim must create + link a 1:1 DRAFT campaign and mirror its email-bearing
// leads into that campaign's prospects, so the leads land in the shared Nurture/Engage
// pipeline. The campaign is DRAFT (kept off the n8n/send paths); email-less leads can't
// become prospects (prospects.email is NOT NULL); re-mirroring must NOT regress status.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NICHE = '99990000-0000-0000-0000-000000000001';

async function makeAim() {
  const repo = new ReachRepository(getDb());
  const aim = await repo.createAim(ORG, {
    name: 'Poland Cyber',
    niche: 'Cybersecurity',
    region: 'Border-DE',
    country: 'Poland',
    sender: 'info',
  });
  return { repo, aim };
}

describe('ReachRepository — aim → campaign link', () => {
  it('createDraftCampaign inserts a DRAFT campaign mapped from the aim', async () => {
    const { repo, aim } = await makeAim();
    const campaignId = await repo.createDraftCampaign(ORG, NICHE, aim);
    const [c] = await getDb()
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId));
    expect(c).toBeDefined();
    expect(c!.lifecycle).toBe('DRAFT');
    expect(c!.organizationId).toBe(ORG);
    expect(c!.nicheId).toBe(NICHE);
    expect(c!.name).toBe('Poland Cyber');
    expect(c!.region).toBe('Border-DE');
    expect(c!.country).toBe('Poland');
  });

  it('setAimCampaign links the aim to the campaign', async () => {
    const { repo, aim } = await makeAim();
    const campaignId = await repo.createDraftCampaign(ORG, NICHE, aim);
    await repo.setAimCampaign(ORG, aim.id, campaignId);
    const linked = await repo.findAimById(ORG, aim.id);
    expect(linked!.campaignId).toBe(campaignId);
  });
});

describe('ReachRepository.mirrorLeadsToProspects', () => {
  it('mirrors ONLY email-bearing leads, upserts, and never regresses status', async () => {
    const { repo, aim } = await makeAim();
    const campaignId = await repo.createDraftCampaign(ORG, NICHE, aim);

    const n = await repo.mirrorLeadsToProspects(
      ORG,
      campaignId,
      [
        { company: 'Alpha GmbH', email: 'alpha@x.com', website: 'alpha.pl', location: 'Kraków' },
        { company: 'NoEmail Co', email: null }, // skipped — prospects.email is NOT NULL
        { company: 'Gamma', email: 'gamma@x.com' },
      ],
      'Poland',
    );
    expect(n).toBe(2);

    const rows = await getDb()
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.campaignId, campaignId));
    expect(rows.map((r) => r.email).sort()).toEqual(['alpha@x.com', 'gamma@x.com']);
    expect(rows.every((r) => r.status === 'NEW' && r.country === 'Poland')).toBe(true);

    // The reply pipeline advances a prospect; a re-scrape must NOT reset it.
    await getDb()
      .update(schema.prospects)
      .set({ status: 'INTERESTED' })
      .where(eq(schema.prospects.email, 'alpha@x.com'));

    await repo.mirrorLeadsToProspects(
      ORG,
      campaignId,
      [{ company: 'Alpha GmbH (renamed)', email: 'alpha@x.com' }],
      'Poland',
    );

    const after = await getDb()
      .select()
      .from(schema.prospects)
      .where(eq(schema.prospects.email, 'alpha@x.com'));
    expect(after).toHaveLength(1); // upsert, not duplicate
    expect(after[0]!.status).toBe('INTERESTED'); // status preserved
    expect(after[0]!.companyName).toBe('Alpha GmbH (renamed)'); // scraped field refreshed
  });
});

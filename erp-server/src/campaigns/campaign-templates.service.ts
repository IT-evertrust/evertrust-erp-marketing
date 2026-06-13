import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { CampaignTemplatesDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

// Ammo Forge content blocks (coldEmail, slotProposal, meetingConfirmation,
// newsBrief, …) stored on campaigns.templates so the outreach workflows read
// templates from the ERP instead of Drive. Machine route — org derived from the
// campaign; audited (actorType N8N). MERGE semantics: the supplied blocks are
// spread over whatever the campaign already holds, so a workflow can set blocks
// incrementally and an existing block is overwritten only when its key is re-sent.
@Injectable()
export class CampaignTemplatesService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async merge(
    campaignId: string,
    incoming: CampaignTemplatesDto,
  ): Promise<CampaignTemplatesDto> {
    const campaignRows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundException(`No campaign for id ${campaignId}`);

    // Read-spread-write: never clobber blocks a previous POST set; only keys in
    // `incoming` are added or overwritten.
    const merged: Record<string, string> = {
      ...(campaign.templates ?? {}),
      ...incoming,
    };

    await this.db
      .update(schema.campaigns)
      .set({ templates: merged })
      .where(eq(schema.campaigns.id, campaignId));

    await writeMachineAudit(this.db, {
      organizationId: campaign.organizationId,
      entity: 'campaigns',
      entityId: campaignId,
      action: 'TEMPLATES',
      after: { keys: Object.keys(incoming) },
    });
    return merged;
  }
}

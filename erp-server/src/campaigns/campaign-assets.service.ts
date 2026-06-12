import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { AssetKind } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { writeMachineAudit } from '../common/machine-audit';

export interface CampaignAssetInput {
  kind: AssetKind;
  name: string;
  driveFileId: string;
  driveUrl?: string;
  mimeType?: string;
}

// Registry of Drive artifacts the Growth-Engine workflows generate (email
// templates, news briefs, niche analyses, …). Upsert on driveFileId (the dedup key),
// so a callback re-delivery updates the same row. Machine route — org derived from
// the campaign; audited (actorType N8N).
@Injectable()
export class CampaignAssetsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async upsert(
    campaignId: string,
    input: CampaignAssetInput,
  ): Promise<{ id: string; created: boolean }> {
    const campaignRows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    const campaign = campaignRows[0];
    if (!campaign) throw new NotFoundException(`No campaign for id ${campaignId}`);

    const existing = await this.db
      .select()
      .from(schema.campaignAssets)
      .where(eq(schema.campaignAssets.driveFileId, input.driveFileId))
      .limit(1);

    let id: string;
    let created: boolean;
    if (existing[0]) {
      // Re-delivery: bump the artifact metadata + version on the same row.
      const updated = await this.db
        .update(schema.campaignAssets)
        .set({
          kind: input.kind,
          name: input.name,
          driveUrl: input.driveUrl ?? existing[0].driveUrl,
          mimeType: input.mimeType ?? existing[0].mimeType,
          version: existing[0].version + 1,
        })
        .where(eq(schema.campaignAssets.id, existing[0].id))
        .returning();
      id = updated[0]?.id ?? existing[0].id;
      created = false;
    } else {
      const inserted = await this.db
        .insert(schema.campaignAssets)
        .values({
          campaignId,
          kind: input.kind,
          name: input.name,
          driveFileId: input.driveFileId,
          driveUrl: input.driveUrl ?? null,
          mimeType: input.mimeType ?? null,
        })
        .returning();
      const row = inserted[0];
      if (!row) throw new Error('Failed to create campaign asset');
      id = row.id;
      created = true;
    }

    await writeMachineAudit(this.db, {
      organizationId: campaign.organizationId,
      entity: 'campaign_assets',
      entityId: id,
      action: created ? 'CREATE' : 'UPDATE',
      after: { campaignId, kind: input.kind, driveFileId: input.driveFileId },
    });
    return { id, created };
  }
}

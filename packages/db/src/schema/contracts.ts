import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { customers } from './core';
import { campaignAssets, campaigns } from './campaigns';
import { leads } from './leads';
import { meetings } from './meetings';
import { contractStatusEnum } from './enums';

// ContractMaker output. The PDF itself stays in Drive (driveFileId/driveUrl —
// the documents.storageUrl philosophy); signing detection flips `status` to
// SIGNED and stamps signedAt. signingMeetingId links the meeting the deal was
// closed in; leadId/customerId/campaignId carry the attribution chain.
export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant boundary. NOT NULL: every contract belongs to exactly one org.
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    leadId: uuid('lead_id').references(() => leads.id),
    customerId: uuid('customer_id').references(() => customers.id),
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    // The contract template asset the PDF was generated from.
    templateAssetId: uuid('template_asset_id').references(
      () => campaignAssets.id,
    ),
    signingMeetingId: uuid('signing_meeting_id').references(() => meetings.id),
    status: contractStatusEnum('status').notNull().default('GENERATED'),
    driveFileId: text('drive_file_id'),
    driveUrl: text('drive_url'),
    // The negotiated cooperation term as printed into the contract.
    cooperationTerm: text('cooperation_term'),
    // --- Contract Assist (Nurture) display + draft fields ---
    // Snapshot of the deal the contract is for, so the Contract Generator table is
    // self-contained + editable. `value` is whole euros; `deadline` is free text
    // ("28 Jun 2026"); `contractType` is Vollmacht | Vertragsvereinbarung | NDA.
    company: text('company'),
    sector: text('sector'),
    value: integer('contract_value'),
    deadline: text('deadline'),
    contractType: text('contract_type'),
    // Read AI analysis summary + key agreement terms shown in the analysis panel.
    analysis: text('analysis'),
    terms: jsonb('terms').$type<string[]>().notNull().default([]),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    // Captured when generation/sending errors (status FAILED).
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('contracts_organization_id_idx').on(t.organizationId),
    index('contracts_lead_id_idx').on(t.leadId),
  ],
);

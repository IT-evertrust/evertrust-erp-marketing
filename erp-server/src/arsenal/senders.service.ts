import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { DEFAULT_SENDERS, type OrgSenderDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';

type OrgSenderRow = typeof schema.orgSenders.$inferSelect;

// The fields an admin may set on a sender (POST body). `key` is the stable org-scoped
// identifier (UNIQUE per org) the campaign's `sender` field + the config defaultSender
// reference; `email` is the real from-address; `label`/`isDefault` are optional.
export interface UpsertOrgSender {
  key: string;
  email: string;
  label?: string | null;
  isDefault?: boolean;
}

// Minimal RFC-ish email shape check (the DTO layer also validates via z.string().email,
// but the service validates too so it holds regardless of the call path).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PER-ORG email senders. One row per from-address an org may send as, keyed by a
// stable org-scoped `sender_key`. The resolved sender LIST falls back to the product
// DEFAULT_SENDERS when an org has configured none of its own — so the legacy
// 'info'/'hanna' identities stay resolvable for an org that never customized them.
//
// This service owns the org_senders CRUD (list/upsert/remove). The resolved list +
// the resolved default sender are surfaced to callers (the Configuration read, the
// machine campaign config, and create-time sender validation) by
// WorkflowConfigService, which composes this resolver with org_config.
@Injectable()
export class SendersService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // The org's own sender rows (raw), newest-or-insertion-agnostic — callers that need
  // the resolved list (org rows OR the product defaults) use resolve() below.
  private async rowsFor(orgId: string): Promise<OrgSenderRow[]> {
    return this.db
      .select()
      .from(schema.orgSenders)
      .where(eq(schema.orgSenders.organizationId, orgId));
  }

  // Map a stored row to the wire DTO.
  private toDto(r: OrgSenderRow): OrgSenderDto {
    return {
      key: r.senderKey,
      email: r.email,
      label: r.label ?? null,
      isDefault: r.isDefault,
    };
  }

  // The RESOLVED sender list for an org: the org's own senders if it has any, else the
  // product DEFAULT_SENDERS. This is the single source of truth shared by the config
  // read, the machine campaign config, and create-time sender-key validation.
  async resolve(orgId: string): Promise<OrgSenderDto[]> {
    return (await this.resolveDetailed(orgId)).senders;
  }

  // The resolved list PLUS whether it came from the org's OWN rows (vs the product
  // DEFAULT_SENDERS fallback). The `fromOrg` flag lets the default-sender resolver
  // honour an org_config.defaultSender pref over a DEFAULT_SENDERS entry's isDefault
  // flag: the product list's `isDefault` is only authoritative when the org has no
  // senders AND no explicit defaultSender pref.
  async resolveDetailed(
    orgId: string,
  ): Promise<{ senders: OrgSenderDto[]; fromOrg: boolean }> {
    const rows = await this.rowsFor(orgId);
    if (rows.length === 0) return { senders: DEFAULT_SENDERS, fromOrg: false };
    return { senders: rows.map((r) => this.toDto(r)), fromOrg: true };
  }

  // GET /arsenal/config/senders — the resolved list (alias of resolve()).
  list(orgId: string): Promise<OrgSenderDto[]> {
    return this.resolve(orgId);
  }

  // POST /arsenal/config/senders — upsert a sender on (organizationId, sender_key).
  // A value for an existing key updates it; a new key inserts. When isDefault is true,
  // the flag is unset on the org's OTHER rows first so at most one default exists.
  // Returns the resolved list. Validates email + key.
  async upsert(orgId: string, body: UpsertOrgSender): Promise<OrgSenderDto[]> {
    const key = (body.key ?? '').trim();
    const email = (body.email ?? '').trim();
    if (key.length === 0) {
      throw new BadRequestException('Sender key must not be empty.');
    }
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestException('Sender email must be a valid email address.');
    }
    const label =
      body.label === undefined || body.label === null || body.label.trim() === ''
        ? null
        : body.label.trim();
    const isDefault = body.isDefault ?? false;

    // All writes run in ONE transaction: clearing the other rows' default flag and
    // setting this row must commit together, or a mid-sequence failure could leave the
    // org with ZERO default senders. Setting this sender as the default first clears
    // the flag on the org's other rows (so exactly one default exists); the row we
    // upsert is re-set to isDefault below.
    await this.db.transaction(async (tx) => {
      if (isDefault) {
        await tx
          .update(schema.orgSenders)
          .set({ isDefault: false })
          .where(eq(schema.orgSenders.organizationId, orgId));
      }

      const existing = await tx
        .select()
        .from(schema.orgSenders)
        .where(
          and(
            eq(schema.orgSenders.organizationId, orgId),
            eq(schema.orgSenders.senderKey, key),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(schema.orgSenders)
          .set({ email, label, isDefault })
          .where(eq(schema.orgSenders.id, existing[0].id));
      } else {
        await tx.insert(schema.orgSenders).values({
          organizationId: orgId,
          senderKey: key,
          email,
          label,
          isDefault,
        });
      }
    });

    return this.resolve(orgId);
  }

  // DELETE /arsenal/config/senders/:key — remove the org sender. Guarded: an org must
  // not be left with ZERO of its own senders (deleting the last row would silently
  // revert the whole org to the product defaults). 404-equivalent BadRequest when the
  // key is unknown for this org. Returns the resolved list.
  async remove(orgId: string, key: string): Promise<OrgSenderDto[]> {
    const k = (key ?? '').trim();
    const rows = await this.rowsFor(orgId);
    const target = rows.find((r) => r.senderKey === k);
    if (!target) {
      throw new BadRequestException(`Unknown sender '${key}'.`);
    }
    if (rows.length <= 1) {
      throw new ConflictException(
        'Cannot delete the last sender — an organization must keep at least one.',
      );
    }
    await this.db
      .delete(schema.orgSenders)
      .where(eq(schema.orgSenders.id, target.id));
    return this.resolve(orgId);
  }
}

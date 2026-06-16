import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type {
  ConnectedGoogleAccountDto,
  GoogleAccountStatus,
  SetGoogleDefaultsDto,
  UserRole,
} from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { TokenCrypto } from './token-crypto';
import { GoogleOAuthService } from './google-oauth.service';

type GoogleAccountRow = typeof schema.googleAccounts.$inferSelect;
type OrgConfigRow = typeof schema.orgConfig.$inferSelect;

// The token + profile a successful OAuth callback hands to upsertFromCallback.
export interface GoogleCallbackTokens {
  sub: string;
  email: string;
  name: string | null;
  refreshToken: string;
  accessToken: string | null;
  expiryDate: number | null;
  scopes: string[];
}

// Endpoint to revoke a Google OAuth token. Best-effort on disconnect — a revoke
// failure must NEVER block deleting the row from our DB.
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// PER-ORG connected Google accounts: list/upsert/set-defaults/disconnect, plus the
// token resolver other services use to get a live access token for the org's chosen
// default Gmail / Calendar account. Every method is org-scoped — a token resolve only
// ever touches the CALLING org's rows, so one tenant can never reach another's Google
// access (the core multi-tenant invariant for this feature).
//
// Encrypted-at-rest: refresh (and optionally access) tokens are AES-256-GCM ciphertext
// via TokenCrypto; the *_enc columns are NEVER returned to callers — the wire DTO
// exposes identity + status + default flags only.
@Injectable()
export class GoogleAccountsService {
  private readonly logger = new Logger(GoogleAccountsService.name);

  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly crypto: TokenCrypto,
    private readonly oauth: GoogleOAuthService,
  ) {}

  // The org's connected accounts as wire DTOs: a row joined to its connecting user's
  // role, with isDefaultGmail/isDefaultCalendar derived from org_config. Never exposes
  // any *_enc field. Ordered newest-connected first.
  async listForOrg(orgId: string): Promise<ConnectedGoogleAccountDto[]> {
    const rows = await this.db
      .select({
        id: schema.googleAccounts.id,
        email: schema.googleAccounts.email,
        displayName: schema.googleAccounts.displayName,
        scopes: schema.googleAccounts.scopes,
        status: schema.googleAccounts.status,
        connectedAt: schema.googleAccounts.connectedAt,
        role: schema.users.role,
      })
      .from(schema.googleAccounts)
      .innerJoin(schema.users, eq(schema.googleAccounts.userId, schema.users.id))
      .where(eq(schema.googleAccounts.organizationId, orgId));

    const orgRow = await this.orgRow(orgId);

    return rows
      .slice()
      .sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime())
      .map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName ?? null,
        role: r.role as UserRole,
        scopes: r.scopes,
        status: r.status as GoogleAccountStatus,
        isDefaultGmail: orgRow.defaultGmailAccountId === r.id,
        isDefaultCalendar: orgRow.defaultCalendarAccountId === r.id,
        connectedAt: r.connectedAt.toISOString(),
      }));
  }

  // Persist the result of a completed OAuth callback. Encrypts the refresh token (+
  // access token when present) and upserts on (organization_id, google_sub) so a
  // re-connect of the same Google account updates its tokens in place. AFTER the
  // upsert, if the org has no default Gmail / Calendar account yet, this freshly
  // connected account becomes that default (mirrors the senders "first one becomes
  // default" behaviour).
  async upsertFromCallback(
    orgId: string,
    userId: string,
    p: GoogleCallbackTokens,
  ): Promise<void> {
    const refreshTokenEnc = this.crypto.encrypt(p.refreshToken);
    const accessTokenEnc = p.accessToken
      ? this.crypto.encrypt(p.accessToken)
      : null;
    const accessTokenExpiresAt = p.expiryDate ? new Date(p.expiryDate) : null;

    await this.db
      .insert(schema.googleAccounts)
      .values({
        organizationId: orgId,
        userId,
        googleSub: p.sub,
        email: p.email,
        displayName: p.name,
        scopes: p.scopes,
        refreshTokenEnc,
        accessTokenEnc,
        accessTokenExpiresAt,
        status: 'CONNECTED',
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.googleAccounts.organizationId,
          schema.googleAccounts.googleSub,
        ],
        set: {
          userId,
          email: p.email,
          displayName: p.name,
          scopes: p.scopes,
          refreshTokenEnc,
          accessTokenEnc,
          accessTokenExpiresAt,
          status: 'CONNECTED',
          lastError: null,
          updatedAt: new Date(),
        },
      });

    // Resolve the row we just wrote so we can default-point at it if needed.
    const saved = await this.db
      .select({ id: schema.googleAccounts.id })
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.googleSub, p.sub),
        ),
      )
      .limit(1);
    const savedId = saved[0]?.id;
    if (!savedId) return;

    const orgRow = await this.orgRow(orgId);
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if (!orgRow.defaultGmailAccountId) set.defaultGmailAccountId = savedId;
    if (!orgRow.defaultCalendarAccountId) set.defaultCalendarAccountId = savedId;
    if (Object.keys(set).length > 0) {
      await this.persistOrg(orgId, set);
    }
  }

  // Set (or clear) the org's default Gmail / Calendar accounts. For each provided
  // field: null clears the pointer; a uuid must reference a google_accounts row in
  // THIS org (else 400 'Unknown Google account'); an omitted field is unchanged.
  // Returns the refreshed list.
  async setDefaults(
    orgId: string,
    dto: SetGoogleDefaultsDto,
  ): Promise<ConnectedGoogleAccountDto[]> {
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};

    if ('defaultGmailAccountId' in dto) {
      const id = dto.defaultGmailAccountId ?? null;
      if (id !== null) await this.assertOwned(orgId, id);
      set.defaultGmailAccountId = id;
    }
    if ('defaultCalendarAccountId' in dto) {
      const id = dto.defaultCalendarAccountId ?? null;
      if (id !== null) await this.assertOwned(orgId, id);
      set.defaultCalendarAccountId = id;
    }

    if (Object.keys(set).length > 0) {
      await this.persistOrg(orgId, set);
    }
    return this.listForOrg(orgId);
  }

  // Disconnect (delete) an account the org owns. FIRST null out any org_config default
  // pointer that referenced it — the FK is ON DELETE NO ACTION, so deleting while a
  // pointer still references it would throw. Then best-effort revoke the token at
  // Google (a revoke failure must not block the delete) and remove the row. Returns
  // the refreshed list. 404 when the row is not in this org.
  async disconnect(
    orgId: string,
    id: string,
  ): Promise<ConnectedGoogleAccountDto[]> {
    const row = await this.ownedRow(orgId, id);
    if (!row) {
      throw new NotFoundException('Google account not found');
    }

    // Clear default pointers that reference this row BEFORE deleting (FK guard).
    const orgRow = await this.orgRow(orgId);
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};
    if (orgRow.defaultGmailAccountId === id) set.defaultGmailAccountId = null;
    if (orgRow.defaultCalendarAccountId === id) {
      set.defaultCalendarAccountId = null;
    }
    if (Object.keys(set).length > 0) {
      await this.persistOrg(orgId, set);
    }

    // Best-effort revoke at Google — never let a revoke failure block the delete.
    await this.revokeBestEffort(row.refreshTokenEnc);

    await this.db
      .delete(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.id, id),
        ),
      );

    return this.listForOrg(orgId);
  }

  // Resolve a LIVE access token for the org's default Gmail / Calendar account:
  // org_config pointer -> the google_accounts row (same org) -> decrypt refresh ->
  // refresh at Google. Returns null on ANY failure (no default set, missing row,
  // decrypt error, refresh error) and logs a warn — callers degrade gracefully.
  async getAccessTokenForOrg(
    orgId: string,
    kind: 'gmail' | 'calendar',
  ): Promise<{ accessToken: string; account: { id: string; email: string } } | null> {
    try {
      const orgRow = await this.orgRow(orgId);
      const accountId =
        kind === 'gmail'
          ? orgRow.defaultGmailAccountId
          : orgRow.defaultCalendarAccountId;
      if (!accountId) return null;

      const row = await this.ownedRow(orgId, accountId);
      if (!row) return null;

      const refreshToken = this.crypto.decrypt(row.refreshTokenEnc);
      const { accessToken, expiryDate } =
        await this.oauth.refreshAccessToken(refreshToken);

      // Best-effort cache the fresh access token back; the null-return-on-failure
      // contract is unaffected if this write fails.
      this.cacheAccessToken(row.id, accessToken, expiryDate).catch(() => undefined);

      return { accessToken, account: { id: row.id, email: row.email } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `getAccessTokenForOrg(${orgId}, ${kind}) failed: ${msg}`,
      );
      return null;
    }
  }

  // ----- helpers -----------------------------------------------------------

  // 400 unless `id` references a google_accounts row in this org.
  private async assertOwned(orgId: string, id: string): Promise<void> {
    const row = await this.ownedRow(orgId, id);
    if (!row) {
      throw new BadRequestException('Unknown Google account');
    }
  }

  // The full row for (orgId, id), or undefined when it is not this org's.
  private async ownedRow(
    orgId: string,
    id: string,
  ): Promise<GoogleAccountRow | undefined> {
    const rows = await this.db
      .select()
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.id, id),
        ),
      )
      .limit(1);
    return rows[0];
  }

  // Best-effort token revoke at Google's revoke endpoint. Decrypts the refresh token
  // and POSTs it; any error (decrypt failure, network, non-2xx) is swallowed with a
  // warn so disconnect() always proceeds to delete the row.
  private async revokeBestEffort(refreshTokenEnc: string): Promise<void> {
    try {
      const refreshToken = this.crypto.decrypt(refreshTokenEnc);
      const res = await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
      if (!res.ok) {
        this.logger.warn(`Google token revoke returned HTTP ${res.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Google token revoke failed (ignored): ${msg}`);
    }
  }

  // Write the freshly minted access token back into the encrypted cache columns.
  private async cacheAccessToken(
    id: string,
    accessToken: string,
    expiryDate: number | null,
  ): Promise<void> {
    await this.db
      .update(schema.googleAccounts)
      .set({
        accessTokenEnc: this.crypto.encrypt(accessToken),
        accessTokenExpiresAt: expiryDate ? new Date(expiryDate) : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleAccounts.id, id));
  }

  // Find-or-create the PER-ORG org_config row (race-safe), mirroring
  // WorkflowConfigService.orgRow so a resolver never has to handle a missing row.
  private async orgRow(orgId: string): Promise<OrgConfigRow> {
    const existing = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    if (existing[0]) return existing[0];

    const inserted = await this.db
      .insert(schema.orgConfig)
      .values({ organizationId: orgId })
      .onConflictDoNothing({ target: schema.orgConfig.organizationId })
      .returning();
    if (inserted[0]) return inserted[0];

    const reread = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    return reread[0]!;
  }

  // Find-or-create the org_config row and apply a partial set (bumping updatedAt),
  // mirroring WorkflowConfigService.persistOrg.
  private async persistOrg(
    orgId: string,
    set: Partial<typeof schema.orgConfig.$inferInsert>,
  ): Promise<void> {
    const rows = await this.db
      .select()
      .from(schema.orgConfig)
      .where(eq(schema.orgConfig.organizationId, orgId))
      .limit(1);
    const existing = rows[0];
    if (existing) {
      await this.db
        .update(schema.orgConfig)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(schema.orgConfig.id, existing.id));
    } else {
      await this.db
        .insert(schema.orgConfig)
        .values({ organizationId: orgId, ...set });
    }
  }
}

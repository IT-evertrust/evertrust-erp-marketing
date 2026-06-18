import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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

// Result of resolving a live access token for an org's mailbox. The failure case
// carries an end-user-facing `reason` so callers can explain WHY in the UI rather
// than degrading to a generic "not connected" shell.
export type MailboxAccess =
  | { ok: true; accessToken: string; account: { id: string; email: string } }
  | { ok: false; reason: string };

// Endpoint to revoke a Google OAuth token. Best-effort on disconnect — a revoke
// failure must NEVER block deleting the row from our DB.
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Calendar scopes that qualify the single default mailbox for Calendar operations.
// The default mailbox always has gmail.send; it can ALSO serve Calendar only when its
// grant includes one of these (incremental authorization keeps scopes additive).
const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
] as const;

// Gmail sending and Gmail fetching are intentionally separate capabilities. The
// existing `gmail` kind is kept for send-side callers. Gmail API fetching uses the
// narrower `gmail-read` kind so a mailbox that only granted gmail.send does not get
// treated as readable.
const GMAIL_SEND_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://mail.google.com/',
] as const;

const GMAIL_READ_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
] as const;

export type GoogleMailboxKind = 'gmail' | 'gmail-read' | 'calendar';

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
  // role, with `isDefault` derived from org_config.defaultMailboxAccountId (the SINGLE
  // default mailbox). The legacy isDefaultGmail/isDefaultCalendar fields mirror isDefault
  // so the current web keeps working until its rewrite. Never exposes any *_enc field.
  // Ordered newest-connected first.
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
      .map((r) => {
        const isDefault = orgRow.defaultMailboxAccountId === r.id;
        return {
          id: r.id,
          email: r.email,
          displayName: r.displayName ?? null,
          role: r.role as UserRole,
          scopes: r.scopes,
          status: r.status as GoogleAccountStatus,
          isDefault,
          // Legacy fields mirror the single default until the web rewrite drops them.
          isDefaultGmail: isDefault,
          isDefaultCalendar: isDefault,
          connectedAt: r.connectedAt.toISOString(),
        };
      });
  }

  // Persist the result of a completed OAuth callback. Encrypts the refresh token (+
  // access token when present) and upserts on (organization_id, google_sub) so a
  // re-connect of the same Google account updates its tokens in place. AFTER the
  // upsert, if the org has no default mailbox yet, this freshly connected account
  // becomes the SINGLE default mailbox.
  async upsertFromCallback(orgId: string, userId: string, p: GoogleCallbackTokens): Promise<void> {
    const refreshTokenEnc = this.crypto.encrypt(p.refreshToken);
    const accessTokenEnc = p.accessToken ? this.crypto.encrypt(p.accessToken) : null;
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
        target: [schema.googleAccounts.organizationId, schema.googleAccounts.googleSub],
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
    if (!orgRow.defaultMailboxAccountId) {
      await this.persistOrg(orgId, { defaultMailboxAccountId: savedId });
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

  // Set (or clear) the org's SINGLE default mailbox. `null` clears the pointer; a uuid
  // must reference a google_accounts row in THIS org (else 400 'Unknown Google account').
  // Writes org_config.default_mailbox_account_id. Returns the refreshed list.
  async setDefaultMailbox(
    orgId: string,
    accountId: string | null,
  ): Promise<ConnectedGoogleAccountDto[]> {
    if (accountId !== null) await this.assertOwned(orgId, accountId);

    await this.persistOrg(orgId, { defaultMailboxAccountId: accountId });

    return this.listForOrg(orgId);
  }

  // Disconnect (delete) an account the org owns. FIRST null out any org_config default
  // pointer that referenced it — the FK is ON DELETE NO ACTION, so deleting while a
  // pointer still references it would throw. Then best-effort revoke the token at
  // Google (a revoke failure must not block the delete) and remove the row. Returns
  // the refreshed list. 404 when the row is not in this org.
  async disconnect(orgId: string, id: string): Promise<ConnectedGoogleAccountDto[]> {
    const row = await this.ownedRow(orgId, id);
    if (!row) {
      throw new NotFoundException('Google account not found');
    }

    // Clear default pointers that reference this row BEFORE deleting (FK guard) — the
    // single default mailbox plus the legacy two pointers, any of which may still point
    // at the row being removed.
    const orgRow = await this.orgRow(orgId);
    const set: Partial<typeof schema.orgConfig.$inferInsert> = {};

    if (orgRow.defaultMailboxAccountId === id) set.defaultMailboxAccountId = null;
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
        and(eq(schema.googleAccounts.organizationId, orgId), eq(schema.googleAccounts.id, id)),
      );

    return this.listForOrg(orgId);
  }

  // Resolve a LIVE access token for the org's SINGLE default mailbox:
  // org_config.defaultMailboxAccountId -> the google_accounts row (same org) ->
  // decrypt refresh -> refresh at Google. The requested kind must match the scopes
  // the mailbox granted: `gmail` for send-side callers, `gmail-read` for Gmail API
  // fetching, and `calendar` for Calendar operations. Returns null on ANY failure
  // and logs a warn — callers degrade gracefully.
  async getAccessTokenForOrg(
    orgId: string,
    kind: GoogleMailboxKind,
  ): Promise<{ accessToken: string; account: { id: string; email: string } } | null> {
    const r = await this.resolveMailbox(orgId, kind);
    return r.ok ? { accessToken: r.accessToken, account: r.account } : null;
  }

  // Same resolution as getAccessTokenForOrg, but returns a DISCRIMINATED result that
  // carries a human-readable `reason` on failure — so callers (Gmail read, Engage
  // scan, Calendar read) can surface WHY in the UI instead of a generic "not
  // connected" shell. The reason strings are end-user-facing.
  async resolveMailbox(orgId: string, kind: GoogleMailboxKind): Promise<MailboxAccess> {
    try {
      const orgRow = await this.orgRow(orgId);

      // 1) Prefer the explicit default-mailbox pointer.
      let row = orgRow.defaultMailboxAccountId
        ? await this.ownedRow(orgId, orgRow.defaultMailboxAccountId)
        : undefined;

      if (orgRow.defaultMailboxAccountId && !row) {
        this.logger.warn(
          `resolveMailbox(${orgId}): default mailbox ${orgRow.defaultMailboxAccountId} no longer exists — falling back to a connected account`,
        );
      }

      // 2) Fallback: when there is no valid default pointer — or the default can't
      //    serve this kind — resolve the org's own CONNECTED account(s). So a single
      //    connected mailbox works even before anyone explicitly "sets default", and a
      //    stale pointer self-heals.
      const connected = await this.connectedRows(orgId);

      if (!row || !this.canServeKind(row, kind)) {
        const pick = connected.find((r) => this.canServeKind(r, kind));
        if (pick) row = pick;
      }

      if (!row) {
        // No usable account. Distinguish "none connected at all" from "connected but
        // none has the needed scope".
        const reason =
          connected.length === 0
            ? 'No Google account is connected for this organization. Connect one in Configuration.'
            : this.missingScopeReason(kind);

        this.logger.warn(
          `resolveMailbox(${orgId}, ${kind}): no usable account (${connected.length} connected) — ${reason}`,
        );

        return { ok: false, reason };
      }

      if (!this.canServeKind(row, kind)) {
        const reason = this.missingScopeReason(kind, row.email);
        this.logger.warn(`resolveMailbox(${orgId}, ${kind}): ${reason}`);
        return { ok: false, reason };
      }

      const refreshToken = this.crypto.decrypt(row.refreshTokenEnc);
      const { accessToken, expiryDate } = await this.oauth.refreshAccessToken(refreshToken);

      // Best-effort cache the fresh access token back; the failure contract is
      // unaffected if this write fails.
      this.cacheAccessToken(row.id, accessToken, expiryDate).catch(() => undefined);

      return { ok: true, accessToken, account: { id: row.id, email: row.email } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';

      // Most often a decrypt failure (GOOGLE_TOKEN_ENC_KEY changed since the token was
      // stored) or a refused refresh (token revoked) — both fixed by reconnecting.
      const reason =
        'The connected Google token could not be refreshed. Reconnect the account (the server encryption key may have changed).';

      this.logger.warn(`resolveMailbox(${orgId}, ${kind}) token error: ${msg} — ${reason}`);

      return { ok: false, reason };
    }
  }

  private canServeKind(row: GoogleAccountRow, kind: GoogleMailboxKind): boolean {
    if (kind === 'calendar') return this.hasCalendarScope(row);
    if (kind === 'gmail-read') return this.hasGmailReadScope(row);
    return this.hasGmailSendScope(row);
  }

  private missingScopeReason(kind: GoogleMailboxKind, email?: string): string {
    if (kind === 'calendar') {
      return email
        ? `The connected account ${email} has not granted Calendar access. Reconnect and allow Calendar.`
        : 'A Google account is connected, but none has Calendar access. Reconnect and allow Calendar.';
    }

    if (kind === 'gmail-read') {
      return email
        ? `The connected account ${email} has not granted Gmail read access. Reconnect and allow Gmail read access.`
        : 'A Google account is connected, but none has Gmail read access. Reconnect and allow Gmail read access.';
    }

    return email
      ? `The connected account ${email} has not granted Gmail send access. Reconnect and allow Gmail.`
      : 'A Google account is connected, but none has Gmail send access. Reconnect and allow Gmail.';
  }

  // True when an account's grant carries a Calendar scope.
  private hasCalendarScope(row: GoogleAccountRow): boolean {
    return this.hasAnyScope(row, CALENDAR_SCOPES);
  }

  private hasGmailSendScope(row: GoogleAccountRow): boolean {
    return this.hasAnyScope(row, GMAIL_SEND_SCOPES);
  }

  private hasGmailReadScope(row: GoogleAccountRow): boolean {
    return this.hasAnyScope(row, GMAIL_READ_SCOPES);
  }

  private hasAnyScope(row: GoogleAccountRow, scopes: readonly string[]): boolean {
    return row.scopes.some((s) => scopes.includes(s));
  }

  // The org's CONNECTED Google accounts, newest-connected first. The token-resolve
  // fallback when no valid default-mailbox pointer is set.
  private async connectedRows(orgId: string): Promise<GoogleAccountRow[]> {
    const rows = await this.db
      .select()
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.status, 'CONNECTED'),
        ),
      );

    return rows.slice().sort((a, b) => b.connectedAt.getTime() - a.connectedAt.getTime());
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
  private async ownedRow(orgId: string, id: string): Promise<GoogleAccountRow | undefined> {
    const rows = await this.db
      .select()
      .from(schema.googleAccounts)
      .where(and(eq(schema.googleAccounts.organizationId, orgId), eq(schema.googleAccounts.id, id)))
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

  // Find-or-create the PER-ORG org_config row so a resolver never has to handle a
  // missing row.
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

  // Find-or-create the org_config row and apply a partial set.
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
      await this.db.insert(schema.orgConfig).values({ organizationId: orgId, ...set });
    }
  }
}

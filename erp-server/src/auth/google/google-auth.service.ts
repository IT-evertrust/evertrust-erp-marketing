import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { MeDto } from '@evertrust/shared';

import { DB, type DbClient } from '../../db/db.tokens';
import { AppConfigService } from '../../config/app-config.service';
import { AuthService } from '../auth.service';
import { decryptToken, encryptToken } from './token-crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
}

interface GoogleUserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

// Google OAuth: "Sign in with Google" for EXISTING users (matched by email — no rogue
// org creation), persisting the refresh token so the backend can later act on the
// user's behalf (Gmail send, Calendar). The agent stays brain-only; tokens live here.
@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: AppConfigService,
    private readonly auth: AuthService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get('GOOGLE_CLIENT_ID') &&
        this.config.get('GOOGLE_CLIENT_SECRET') &&
        this.config.get('GOOGLE_OAUTH_REDIRECT_URI'),
    );
  }

  // The consent URL. offline + prompt=consent so Google returns a refresh token.
  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.get('GOOGLE_CLIENT_ID'),
      redirect_uri: this.config.get('GOOGLE_OAUTH_REDIRECT_URI'),
      response_type: 'code',
      scope: this.config.get('GOOGLE_OAUTH_SCOPES'),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  // Exchange the code, match an existing active user by email, persist the grant,
  // and mint the SAME session JWT the password login issues.
  async handleCallback(
    code: string,
  ): Promise<{ accessToken: string; user: MeDto }> {
    const tokens = await this.exchangeCode(code);
    const info = await this.fetchUserInfo(tokens.access_token);
    if (!info.email) {
      throw new UnauthorizedException('Google account has no email');
    }

    const user = await this.auth.findActiveUserByEmail(info.email);
    if (!user) {
      throw new ForbiddenException(
        `No EVERTRUST account for ${info.email}. Ask an admin to create one first.`,
      );
    }

    await this.persistGrant(user.organizationId, user.id, info, tokens);
    const accessToken = await this.auth.signSession(user);
    return { accessToken, user };
  }

  // A fresh Google access token for the user (refreshing if needed). The Gmail/Calendar
  // send layer will call this. Returns null if the user hasn't linked Google. Tokens are
  // stored encrypted, so the cached access token is decrypted before use.
  async getAccessToken(userId: string): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.userId, userId))
      .orderBy(desc(schema.googleAccounts.updatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.freshTokenForRow(row);
  }

  // The org's connected Google accounts (the mailbox axis for the Activate Meeting Booker —
  // each is an email account whose calendar can be read). Newest grant first.
  async listConnectedAccounts(orgId: string): Promise<
    Array<{ id: string; email: string; displayName: string | null; status: string }>
  > {
    const rows = await this.db
      .select({
        id: schema.googleAccounts.id,
        email: schema.googleAccounts.email,
        displayName: schema.googleAccounts.displayName,
        status: schema.googleAccounts.status,
      })
      .from(schema.googleAccounts)
      .where(eq(schema.googleAccounts.organizationId, orgId))
      .orderBy(desc(schema.googleAccounts.updatedAt));
    return rows;
  }

  // A fresh access token for a SPECIFIC connected account (by id), org-scoped. Lets the
  // backend read another worker's calendar (like Engage's inbox switch). Null if not found.
  async getAccessTokenForAccountId(
    orgId: string,
    accountId: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select()
      .from(schema.googleAccounts)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, orgId),
          eq(schema.googleAccounts.id, accountId),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // A grant whose token can't be decrypted/refreshed (stale enc key, revoked, expired) is
    // treated as unusable rather than crashing the caller — the Booker shows an empty calendar.
    try {
      return await this.freshTokenForRow(row);
    } catch (err) {
      this.logger.warn(
        `Google grant ${accountId} unusable: ${err instanceof Error ? err.message : 'error'}`,
      );
      return null;
    }
  }

  // Return a valid access token for a stored grant row, refreshing from the encrypted
  // refresh token when the cached access token is missing/expired.
  private async freshTokenForRow(
    row: typeof schema.googleAccounts.$inferSelect,
  ): Promise<string> {
    const enc = this.config.get('GOOGLE_TOKEN_ENC_KEY');
    const now = Date.now();
    if (
      row.accessTokenEnc &&
      row.accessTokenExpiresAt &&
      row.accessTokenExpiresAt.getTime() - 60_000 > now
    ) {
      return decryptToken(row.accessTokenEnc, enc);
    }

    const refreshToken = decryptToken(row.refreshTokenEnc, enc);
    const refreshed = await this.postToken(
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: this.config.get('GOOGLE_CLIENT_ID'),
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET'),
        grant_type: 'refresh_token',
      }),
    );
    const expiresAt = new Date(now + refreshed.expires_in * 1000);
    await this.db
      .update(schema.googleAccounts)
      .set({
        accessTokenEnc: encryptToken(refreshed.access_token, enc),
        accessTokenExpiresAt: expiresAt,
        status: 'CONNECTED',
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.googleAccounts.id, row.id));
    return refreshed.access_token;
  }

  private async persistGrant(
    organizationId: string,
    userId: string,
    info: GoogleUserInfo,
    tokens: GoogleTokenResponse,
  ): Promise<void> {
    const enc = this.config.get('GOOGLE_TOKEN_ENC_KEY');
    if (!enc) {
      throw new ServiceUnavailableException(
        'GOOGLE_TOKEN_ENC_KEY is not set; cannot store the Google grant.',
      );
    }
    const accessTokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    // Grants are keyed by (organizationId, googleSub) in the DB.
    const base = {
      email: info.email ?? '',
      displayName: info.name ?? null,
      scopes: tokens.scope ? tokens.scope.split(' ') : [],
      accessTokenEnc: encryptToken(tokens.access_token, enc),
      accessTokenExpiresAt,
      status: 'CONNECTED' as const,
      lastError: null,
      updatedAt: new Date(),
    };

    if (tokens.refresh_token) {
      const refreshTokenEnc = encryptToken(tokens.refresh_token, enc);
      await this.db
        .insert(schema.googleAccounts)
        .values({
          organizationId,
          userId,
          googleSub: info.sub,
          refreshTokenEnc,
          ...base,
        })
        .onConflictDoUpdate({
          target: [
            schema.googleAccounts.organizationId,
            schema.googleAccounts.googleSub,
          ],
          set: { userId, refreshTokenEnc, ...base },
        });
      return;
    }

    // Google omitted a refresh token (can happen on re-consent). Update the cached
    // access token but keep the stored refresh token. If there is no existing row,
    // we have no usable grant — tell the user to retry consent.
    const updated = await this.db
      .update(schema.googleAccounts)
      .set(base)
      .where(
        and(
          eq(schema.googleAccounts.organizationId, organizationId),
          eq(schema.googleAccounts.googleSub, info.sub),
        ),
      )
      .returning();
    if (!updated[0]) {
      throw new ServiceUnavailableException(
        'Google did not return a refresh token; please retry the consent.',
      );
    }
  }

  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    return this.postToken(
      new URLSearchParams({
        code,
        client_id: this.config.get('GOOGLE_CLIENT_ID'),
        client_secret: this.config.get('GOOGLE_CLIENT_SECRET'),
        redirect_uri: this.config.get('GOOGLE_OAUTH_REDIRECT_URI'),
        grant_type: 'authorization_code',
      }),
    );
  }

  private async postToken(
    body: URLSearchParams,
  ): Promise<GoogleTokenResponse> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Google token endpoint ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await res.json()) as GoogleTokenResponse;
  }

  private async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new UnauthorizedException('Failed to fetch Google profile');
    }
    return (await res.json()) as GoogleUserInfo;
  }
}

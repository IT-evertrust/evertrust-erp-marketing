import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppConfigService } from '../config/app-config.service';
import { GoogleAccountsService } from '../google/google-accounts.service';

// Lists the Google Calendars an org can write to, for the AIM Lock & Load form's
// Calendar dropdown.
//
// AUTH MODEL (per-org first, global fallback): listCalendars(orgId) first resolves the
// CALLING org's default connected Calendar account (GoogleAccountsService) and uses
// that account's live access token — so each tenant sees only its OWN calendars (the
// multi-tenant fix). When the org has no connected Calendar account, it falls back to
// the single deployment-wide `authorized_user` token in GOOGLE_CALENDAR_TOKEN_JSON
// ({ client_id, client_secret, refresh_token, type: "authorized_user" }) for
// back-compat with deployments that haven't connected per-org accounts yet.
//
// NEVER-THROW CONTRACT: listCalendars() must NEVER throw. It powers a dropdown on a
// page load, so any failure (no token, bad JSON, OAuth refresh failure, non-2xx, network
// error) is logged at warn level and degraded to { configured: false, calendars: [] }.
// The UI treats `configured: false` as "fall back to the org-default calendar" rather
// than blocking the form.
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly googleAccounts: GoogleAccountsService,
  ) {}

  async listCalendars(orgId: string): Promise<{
    configured: boolean;
    calendars: { id: string; summary: string; primary: boolean }[];
  }> {
    // Per-org path: use the org's default connected Calendar account's access token
    // when one resolves. Never throws (getAccessTokenForOrg returns null on failure).
    const perOrg = await this.googleAccounts.getAccessTokenForOrg(orgId, 'calendar');
    if (perOrg) {
      return this.fetchCalendars(perOrg.accessToken);
    }

    // Fallback: the single deployment-wide authorized_user token (back-compat).
    const raw = this.config.get('GOOGLE_CALENDAR_TOKEN_JSON');
    if (!raw) {
      // Not wired — expected when the deployment hasn't connected a Google account.
      return { configured: false, calendars: [] };
    }

    let clientId: unknown;
    let clientSecret: unknown;
    let refreshToken: unknown;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      clientId = parsed.client_id;
      clientSecret = parsed.client_secret;
      refreshToken = parsed.refresh_token;
    } catch {
      this.logger.warn(
        'GOOGLE_CALENDAR_TOKEN_JSON is not valid JSON — calendar scan disabled',
      );
      return { configured: false, calendars: [] };
    }

    if (
      typeof clientId !== 'string' ||
      typeof clientSecret !== 'string' ||
      typeof refreshToken !== 'string' ||
      !clientId ||
      !clientSecret ||
      !refreshToken
    ) {
      this.logger.warn(
        'GOOGLE_CALENDAR_TOKEN_JSON is missing client_id/client_secret/refresh_token — calendar scan disabled',
      );
      return { configured: false, calendars: [] };
    }

    try {
      const client = new OAuth2Client({ clientId, clientSecret });
      client.setCredentials({ refresh_token: refreshToken });
      const { token } = await client.getAccessToken();
      return this.fetchCalendars(token ?? undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Google calendar scan failed: ${msg}`);
      return { configured: false, calendars: [] };
    }
  }

  // GET the calendarList with a bearer access token and map it to the dropdown shape
  // (primary first, then alphabetical by display label). Shared by the per-org and the
  // global-fallback paths. Preserves the NEVER-THROW contract — any non-2xx, network
  // error, or bad body degrades to { configured: false, calendars: [] }.
  private async fetchCalendars(token: string | undefined): Promise<{
    configured: boolean;
    calendars: { id: string; summary: string; primary: boolean }[];
  }> {
    if (!token) {
      return { configured: false, calendars: [] };
    }
    try {
      const res = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer&showHidden=false',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        this.logger.warn(
          `Google calendarList returned HTTP ${res.status} — calendar scan disabled`,
        );
        return { configured: false, calendars: [] };
      }

      const data = (await res.json()) as {
        items?: {
          id?: string;
          summary?: string;
          summaryOverride?: string;
          primary?: boolean;
        }[];
      };
      const calendars = (data.items ?? [])
        .filter((item): item is { id: string } & typeof item => !!item.id)
        .map((item) => ({
          id: item.id,
          summary: item.summaryOverride ?? item.summary ?? item.id,
          primary: !!item.primary,
        }))
        // Primary calendar first, then alphabetical by display label.
        .sort((a, b) => {
          if (a.primary !== b.primary) return a.primary ? -1 : 1;
          return a.summary.localeCompare(b.summary);
        });

      return { configured: true, calendars };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`Google calendar scan failed: ${msg}`);
      return { configured: false, calendars: [] };
    }
  }
}

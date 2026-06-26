import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { GOOGLE_CONNECT_SCOPES } from '@evertrust/shared';
import type {
  ConnectedGoogleAccountDto,
  SetDefaultMailboxDto,
  SetGoogleDefaultsDto,
} from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { SetDefaultMailboxBodyDto, SetGoogleDefaultsBodyDto } from './google.dto';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleAccountsService } from './google-accounts.service';

// The signed state JWT carried through the OAuth round-trip. `typ:'gconnect'`
// distinguishes it from a normal auth token so an auth token can never be replayed
// as connect state.
interface ConnectState {
  org: string;
  sub: string;
  typ: 'gconnect';
}

// Per-org Google connect: the browser OAuth round-trip plus the admin management
// endpoints. The connect/start + callback pair runs the authorization-code flow;
// the /google/accounts endpoints (admin:config) list/default/disconnect the org's
// connected accounts.
//
// The state between start and callback is a short-TTL JWT signed by the SAME
// JwtService the auth module uses, carrying the org + connecting user id so the
// public callback can attribute the new account WITHOUT a session (the callback is
// @Public — Google calls it with no cookie).
@Controller('google')
export class GoogleConnectController {
  constructor(
    private readonly oauth: GoogleOAuthService,
    private readonly accounts: GoogleAccountsService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  // Begin the connect flow: returns the Google consent URL the client redirects the
  // browser to. 503 when the feature is not configured. The state is a 10-minute JWT
  // binding the consent to this org + user so the public callback can attribute it.
  // ANY authenticated user may connect THEIR OWN account (consent is per-person — an
  // admin cannot click through Google for an employee); managing the org defaults +
  // listing/disconnecting stays admin:config below.
  @Get('connect/start')
  async start(@OrgId() orgId: string, @CurrentUser() user: AuthUser): Promise<{ url: string }> {
    if (!this.oauth.isConfigured()) {
      throw new ServiceUnavailableException('Google connect is not configured');
    }
    const state = await this.jwt.signAsync(
      { org: orgId, sub: user.id, typ: 'gconnect' } satisfies ConnectState,
      { expiresIn: '10m' },
    );
    return { url: this.oauth.buildConsentUrl(state) };
  }

  // Google's redirect target. PUBLIC (Google calls it with no session). Verifies the
  // state JWT, exchanges the code, and upserts the account, then redirects the browser
  // back to the web app. WRAPPED so it NEVER 500s to the browser — every failure path
  // ends in a redirect (or inline HTML when APP_WEB_URL is blank).
  @Public()
  @Get('connect/callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    try {
      if (error || !code || !state) {
        return this.redirect(res, false);
      }

      let claims: ConnectState;
      try {
        claims = await this.jwt.verifyAsync<ConnectState>(state);
      } catch {
        return this.redirect(res, false);
      }
      if (claims.typ !== 'gconnect' || !claims.org || !claims.sub) {
        return this.redirect(res, false);
      }

      const tokens = await this.oauth.exchangeCode(code);
      await this.accounts.upsertFromCallback(claims.org, claims.sub, {
        sub: tokens.sub,
        email: tokens.email,
        name: tokens.name,
        refreshToken: tokens.refreshToken,
        accessToken: tokens.accessToken,
        expiryDate: tokens.expiryDate,
        // Record the requested connect scopes (incremental authorization keeps the
        // actual grant a superset of these).
        scopes: tokens.scopes,
      });

      return this.redirect(res, true);
    } catch {
      // Any unexpected failure still degrades to a friendly redirect/HTML.
      return this.redirect(res, false);
    }
  }

  // List the org's connected Google accounts.
  @RequirePermissions('admin:config')
  @Get('accounts')
  list(@OrgId() orgId: string): Promise<ConnectedGoogleAccountDto[]> {
    return this.accounts.listForOrg(orgId);
  }

  // Set the org's default Gmail / Calendar account(s). Returns the refreshed list.
  // LEGACY two-pointer endpoint — kept until the web migrates to the single-mailbox
  // POST accounts/default below.
  @RequirePermissions('admin:config')
  @Post('accounts/defaults')
  setDefaults(
    @OrgId() orgId: string,
    @Body() body: SetGoogleDefaultsBodyDto,
  ): Promise<ConnectedGoogleAccountDto[]> {
    return this.accounts.setDefaults(orgId, body as SetGoogleDefaultsDto);
  }

  // Set the org's SINGLE default mailbox (used for both Gmail send and Calendar).
  // accountId: uuid|null (null clears). Returns the refreshed list.
  @RequirePermissions('admin:config')
  @Post('accounts/default')
  setDefaultMailbox(
    @OrgId() orgId: string,
    @Body() body: SetDefaultMailboxBodyDto,
  ): Promise<ConnectedGoogleAccountDto[]> {
    return this.accounts.setDefaultMailbox(orgId, (body as SetDefaultMailboxDto).accountId);
  }

  // Disconnect (delete + best-effort revoke) one of the org's accounts. Returns the
  // refreshed list.
  @RequirePermissions('admin:config')
  @Delete('accounts/:id')
  disconnect(
    @OrgId() orgId: string,
    @Param('id') id: string,
  ): Promise<ConnectedGoogleAccountDto[]> {
    return this.accounts.disconnect(orgId, id);
  }

  // Redirect the browser back to the web app's Settings page with a status query
  // param. When APP_WEB_URL is blank (e.g. local-only API), fall back to a minimal
  // inline HTML page so the popup/tab still shows a clear outcome.
  private redirect(res: Response, ok: boolean): void {
    const webUrl = this.config.get('APP_WEB_URL').trim();
    if (webUrl) {
      const base = webUrl.replace(/\/+$/, '');
      const status = ok ? 'connected' : 'error';
      res.redirect(302, `${base}/settings/general?google=${status}`);
      return;
    }
    const message = ok
      ? 'Google account connected — you can close this tab.'
      : 'Connection failed.';
    res
      .status(ok ? 200 : 400)
      .type('html')
      .send(`<!doctype html><html><body><p>${message}</p></body></html>`);
  }
}

import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AppConfigService } from '../config/app-config.service';
import { TokenCrypto } from './token-crypto';
import { GoogleOAuthService } from './google-oauth.service';
import { GoogleAccountsService } from './google-accounts.service';
import { GoogleGmailService } from './google-gmail.service';
import { GoogleConnectController } from './google-connect.controller';
import { GoogleCalendarReadService } from './google-calendar-read.service';
import { GoogleCalendarReadController } from './google-calendar-read.controller';

// Per-org Google connect (increment 1): the OAuth authorization-code flow + the
// admin endpoints to list/default/disconnect connected accounts, plus the token
// resolver (GoogleAccountsService.getAccessTokenForOrg) other features consume.
//
// JwtService is needed to sign + verify the short-TTL connect STATE token (the
// org+user binding carried through the OAuth round-trip). AuthModule's JwtModule is
// not exported, so this module registers its OWN JwtModule with the SAME secret +
// expiry from env — the state token is independent of the auth session token (it
// carries a `typ:'gconnect'` marker so the two can never be confused).
//
// GoogleAccountsService is EXPORTED so other modules (workflow-config) can resolve a
// per-org access token. GoogleModule deliberately imports NOTHING feature-specific so
// it sits at the bottom of the dependency graph (workflow-config imports it, never the
// reverse — that is how the calendar-list refactor avoids a circular module dep). Its
// remaining deps (DB + AppConfigService) are global.
//
// The Activate read endpoints (GET /meetings/calendar/{upcoming,free-slots}) live
// here too: GoogleCalendarReadService consumes GoogleAccountsService (already provided
// in this module) to read the org's default calendar — no extra cross-module wiring.
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): JwtModuleOptions => ({
        secret: config.get('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN') as unknown as number,
        },
      }),
    }),
  ],
  controllers: [GoogleConnectController, GoogleCalendarReadController],
  providers: [
    TokenCrypto,
    GoogleOAuthService,
    GoogleAccountsService,
    GoogleGmailService,
    GoogleCalendarReadService,
  ],
  exports: [GoogleAccountsService, GoogleGmailService],
})
export class GoogleModule {}

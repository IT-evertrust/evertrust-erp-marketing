import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_CONNECT_SCOPES } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { TokenCrypto } from './token-crypto';

// The identity + tokens exchanged from an authorization code. `refreshToken` is
// REQUIRED (we ask for prompt:'consent' precisely so Google always returns one);
// accessToken/expiryDate are the short-lived current token; sub/email/name come
// from verifying the returned id_token.
export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string | null;
  expiryDate: number | null;
  sub: string;
  email: string;
  name: string | null;
}

// Wraps a google-auth-library OAuth2Client for the per-org connect flow (distinct
// from the GIS login, which only verifies an id_token and holds no API access).
// This is the authorization-CODE flow: build a consent URL, exchange the returned
// code for tokens, and refresh an access token from a stored refresh token.
//
// CONFIG: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_OAUTH_REDIRECT_URI plus
// a valid token-encryption key. When any is missing the feature is OFF
// (isConfigured() === false) and the controller answers 503 instead of erroring
// deep in the OAuth client.
@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly crypto: TokenCrypto,
  ) {}

  // True only when the full connect flow can run: the OAuth client id/secret/redirect
  // are set AND a valid token-encryption key is present (refresh tokens are useless if
  // we cannot store them encrypted).
  isConfigured(): boolean {
    return (
      !!this.config.get('GOOGLE_CLIENT_ID') &&
      !!this.config.get('GOOGLE_CLIENT_SECRET') &&
      !!this.config.get('GOOGLE_OAUTH_REDIRECT_URI') &&
      this.crypto.isConfigured()
    );
  }

  // A fresh OAuth2Client bound to the configured web-client credentials + redirect.
  private client(): OAuth2Client {
    return new OAuth2Client({
      clientId: this.config.get('GOOGLE_CLIENT_ID'),
      clientSecret: this.config.get('GOOGLE_CLIENT_SECRET'),
      redirectUri: this.config.get('GOOGLE_OAUTH_REDIRECT_URI'),
    });
  }

  // Build the Google consent URL the browser is redirected to. access_type:'offline'
  // + prompt:'consent' guarantee a refresh token (even on re-consent);
  // include_granted_scopes enables incremental authorization so later increments can
  // add scopes without re-consenting these. `state` is the signed JWT we verify on
  // the callback.
  buildConsentUrl(state: string): string {
    return this.client().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: true,
      scope: [...GOOGLE_CONNECT_SCOPES],
      state,
    });
  }

  // Exchange an authorization code for tokens + the verified account identity. The
  // id_token is verified against our own client id (audience) to extract a trusted
  // sub/email/name. Throws when no refresh_token came back — Google omits it when the
  // user already granted before, but prompt:'consent' should prevent that; the message
  // tells the caller to revoke access at myaccount.google.com and retry.
  async exchangeCode(code: string): Promise<ExchangedTokens> {
    const client = this.client();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. Revoke this app at ' +
          'myaccount.google.com/permissions and connect again.',
      );
    }
    if (!tokens.id_token) {
      throw new Error('Google did not return an id_token');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.config.get('GOOGLE_CLIENT_ID'),
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) {
      throw new Error('Google id_token is missing sub/email');
    }

    return {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token ?? null,
      expiryDate: tokens.expiry_date ?? null,
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
    };
  }

  // Mint a fresh access token from a stored refresh token. Sets the refresh token as
  // the client's credentials and asks for an access token (the client refreshes
  // automatically); the new expiry is read back off the client's credentials.
  async refreshAccessToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiryDate: number | null }> {
    const client = this.client();
    client.setCredentials({ refresh_token: refreshToken });
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error('Google refresh did not return an access token');
    }
    return {
      accessToken: token,
      expiryDate: client.credentials.expiry_date ?? null,
    };
  }
}

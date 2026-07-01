import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppConfigService } from '../config/app-config.service';

// The verified identity we extract from a Google ID token. `emailVerified`
// mirrors Google's `email_verified` claim; GoogleAuthService REQUIRES it true
// before trusting the address.
export interface VerifiedGoogleUser {
  email: string;
  emailVerified: boolean;
  name: string;
  // Google's stable account id (`sub` claim). Present from the code-flow decode
  // (used to key the connected mailbox); optional because the One-Tap verifier path
  // doesn't need it.
  sub?: string;
}

// Abstraction over Google ID-token verification so the auth service depends on
// an interface, not the network. The real impl (GoogleTokenVerifier) calls
// google-auth-library; tests bind a FAKE under this token (no HTTP).
export interface TokenVerifier {
  // Verify a Google ID token against the configured audience. Returns the
  // identity on success; throws on an invalid / expired token or wrong audience
  // (GoogleAuthService maps that to 401). The configured-or-not check (503) is
  // the service's responsibility, kept out of the verifier so the abstraction
  // stays a pure "verify this token" contract.
  verify(idToken: string): Promise<VerifiedGoogleUser>;
}

// DI token for the TokenVerifier provider — a Symbol so it can never collide with
// a class token and is trivially overridable in a TestingModule.
export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

// Production verifier. Wraps a single OAuth2Client and calls verifyIdToken with
// the GOOGLE_CLIENT_ID as the required audience, so a token minted for any other
// client is rejected. Maps the Google payload to our VerifiedGoogleUser shape.
@Injectable()
export class GoogleTokenVerifier implements TokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AppConfigService) {}

  async verify(idToken: string): Promise<VerifiedGoogleUser> {
    const audience = this.config.get('GOOGLE_CLIENT_ID');
    const ticket = await this.client.verifyIdToken({ idToken, audience });
    const payload = ticket.getPayload();
    return {
      email: payload?.email ?? '',
      emailVerified: payload?.email_verified === true,
      name: payload?.name ?? '',
    };
  }
}

import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import {
  companyEmailDomain,
  effectivePermissions,
  isPublicEmailDomain,
  orgNameFromDomain,
  orgSlugFromDomain,
} from '@evertrust/shared';
import type { LoginResponseDto, MeDto, UserRole } from '@evertrust/shared';
import { AppConfigService } from '../config/app-config.service';
import { DB, type DbClient } from '../db/db.tokens';
import type { JwtPayload } from './auth.types';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier';

// Google-only login + domain-based org auto-provisioning.
//
// FLOW (loginWithGoogle):
//   1. Verify the Google ID token (503 if unconfigured, 401 if invalid/wrong aud).
//   2. Require email_verified — an unverified Google address is rejected (401).
//   3. Gate on the email DOMAIN: a personal provider (gmail.com, …) can't create
//      or join a company org → 403.
//   4. Resolve the principal:
//        a. existing active user by email  → log them in (role/org preserved).
//        b. else org with that domain exists → create the user as EMPLOYEE.
//        c. else                            → create the org + first user as
//           SUPER_ADMIN (the org owner; never OWNER — that's the reserved
//           cross-org platform role). At most ONE SA per org: if the joined org
//           somehow already has a SUPER_ADMIN, the new user is EMPLOYEE instead.
//   5. Mint the JWT EXACTLY as AuthService.login does (same payload + signer).
//
// Google users have NO password, so we NEVER write an auth_credentials row.
@Injectable()
export class GoogleAuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async loginWithGoogle(idToken: string): Promise<LoginResponseDto> {
    // 503 BEFORE we touch the verifier: Google login isn't configured yet, so
    // fail with a clear "not available" instead of an opaque verifier error.
    if (!this.config.get('GOOGLE_CLIENT_ID')) {
      throw new ServiceUnavailableException('Google login is not configured');
    }

    let verified;
    try {
      verified = await this.verifier.verify(idToken);
    } catch {
      // Invalid signature, expired, or wrong audience — all map to a single
      // generic 401 so we don't leak which check failed.
      throw new UnauthorizedException('Invalid Google token');
    }

    if (!verified.emailVerified) {
      throw new UnauthorizedException('Google email is not verified');
    }

    const email = verified.email.trim().toLowerCase();
    if (!email) throw new UnauthorizedException('Invalid Google token');

    const domain = companyEmailDomain(email);
    if (!domain || isPublicEmailDomain(domain)) {
      throw new ForbiddenException('Use your company Google account');
    }

    // (a) Existing user → log in (role + org as stored).
    const existing = await this.findUserByEmail(email);
    if (existing) {
      if (!existing.active) {
        throw new UnauthorizedException('Account is deactivated');
      }
      const orgName = await this.orgNameById(existing.organizationId);
      return this.issue({ ...existing, organizationName: orgName });
    }

    // (b)/(c) Provision: join the org that owns this domain, or create it.
    const org = await this.resolveOrCreateOrg(domain);
    // Role rule: the FIRST user of a BRAND-NEW org becomes that org's single
    // SUPER_ADMIN (its owner); anyone joining an EXISTING org is an EMPLOYEE.
    // Defensive guard: an org may have AT MOST ONE Super Admin, so even on the
    // brand-new-org path, if that org somehow ALREADY has a SUPER_ADMIN, the new
    // user is an EMPLOYEE — we never mint a 2nd SA. (never OWNER — that's the
    // reserved cross-org platform role.)
    const orgHasSuperAdmin = await this.orgHasSuperAdmin(org.id);
    const role: UserRole =
      org.created && !orgHasSuperAdmin ? 'SUPER_ADMIN' : 'EMPLOYEE';

    const inserted = await this.db
      .insert(schema.users)
      .values({
        organizationId: org.id,
        role,
        name: verified.name.trim() || email,
        email,
      })
      .returning();
    const created = inserted[0];
    if (!created) {
      // Unreachable: an insert with .returning() always yields the new row.
      throw new ServiceUnavailableException('User provisioning failed');
    }

    return this.issue({
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      department: created.department,
      position: created.position,
      permissions: created.permissions,
      organizationId: created.organizationId,
      organizationName: org.name,
    });
  }

  // Case-insensitive lookup: the email is already lowercased by the caller and we
  // store emails lowercased, so an `eq` on the normalized value is the match. The
  // org name is fetched separately (orgNameById) to keep this a single-table read.
  private async findUserByEmail(email: string) {
    const rows = await this.db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
        role: schema.users.role,
        department: schema.users.department,
        position: schema.users.position,
        permissions: schema.users.permissions,
        organizationId: schema.users.organizationId,
        active: schema.users.active,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return rows[0];
  }

  private async orgNameById(id: string): Promise<string | undefined> {
    const rows = await this.db
      .select({ name: schema.organizations.name })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);
    return rows[0]?.name;
  }

  // Org invariant: at most one Super Admin per org. True when this org already
  // has a SUPER_ADMIN — used to never self-provision a 2nd one. OWNER (the
  // cross-org platform role) is deliberately not counted here.
  private async orgHasSuperAdmin(orgId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.organizationId, orgId),
          eq(schema.users.role, 'SUPER_ADMIN'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  // Find the org for a domain, or create it. RACE-SAFE: the create relies on the
  // unique `organizations_domain_uq` index — onConflictDoNothing means a loser of
  // the race inserts nothing, and we re-read the winner's row. `created` tells the
  // caller whether the new user is the org's first member (→ SUPER_ADMIN).
  private async resolveOrCreateOrg(
    domain: string,
  ): Promise<{ id: string; name: string; created: boolean }> {
    const found = await this.findOrgByDomain(domain);
    if (found) return { ...found, created: false };

    const name = orgNameFromDomain(domain) || domain;
    const slug = await this.uniqueSlug(orgSlugFromDomain(domain) || domain);

    const inserted = await this.db
      .insert(schema.organizations)
      .values({ name, slug, domain })
      .onConflictDoNothing({ target: schema.organizations.domain })
      .returning({
        id: schema.organizations.id,
        name: schema.organizations.name,
      });

    if (inserted[0]) return { ...inserted[0], created: true };

    // Lost the race — another request created the org for this domain first.
    const reread = await this.findOrgByDomain(domain);
    if (!reread) {
      // Should be unreachable (conflict implies a row exists), but never mint a
      // user with no org.
      throw new ServiceUnavailableException('Organization provisioning failed');
    }
    return { ...reread, created: false };
  }

  private async findOrgByDomain(domain: string) {
    const rows = await this.db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
      })
      .from(schema.organizations)
      .where(eq(schema.organizations.domain, domain))
      .limit(1);
    return rows[0];
  }

  // Ensure the slug is free, suffixing -2, -3, … on collision (the slug column is
  // independently unique from domain, so a derived slug could clash with an
  // unrelated org).
  private async uniqueSlug(base: string): Promise<string> {
    let candidate = base;
    let n = 1;
    // Bounded loop — the suffix grows until a gap is found.
    while (await this.slugTaken(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  private async slugTaken(slug: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  // Build the public user DTO + mint the JWT EXACTLY as AuthService.login does:
  // same payload ({ sub, role, org }) signed by the same JwtService.
  private async issue(row: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    department: MeDto['department'];
    position: MeDto['position'];
    permissions: readonly string[] | null;
    organizationId: string;
    organizationName?: string;
  }): Promise<LoginResponseDto> {
    const user: MeDto = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      department: row.department,
      position: row.position,
      permissions: effectivePermissions(row.role, row.permissions),
      organizationId: row.organizationId,
      organizationName: row.organizationName,
    };
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      org: user.organizationId,
    };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, user };
  }
}

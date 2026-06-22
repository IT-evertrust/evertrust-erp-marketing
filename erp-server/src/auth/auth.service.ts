import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { asc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { effectivePermissions } from '@evertrust/shared';
import type { LoginDto, LoginResponseDto, MeDto } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import type { JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly jwt: JwtService,
  ) {}

  // Verify credentials and mint a JWT. Returns the token + the public user shape.
  // Throws 401 on any failure (unknown email, no credential, bad password) with
  // a single generic message so we don't leak which part failed.
  async login(dto: LoginDto): Promise<LoginResponseDto> {
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
        organizationName: schema.organizations.name,
        active: schema.users.active,
        passwordHash: schema.authCredentials.passwordHash,
      })
      .from(schema.users)
      .innerJoin(
        schema.authCredentials,
        eq(schema.authCredentials.userId, schema.users.id),
      )
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.users.organizationId),
      )
      .where(eq(schema.users.email, dto.email))
      .limit(1);

    const row = rows[0];
    if (!row || !row.active) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(row.passwordHash, dto.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

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
    const accessToken = await this.signSession(user);
    return { accessToken, user };
  }

  // Mint the session JWT for a resolved user. Shared by password login and the
  // Google OAuth callback so both issue an identical session.
  async signSession(user: MeDto): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      org: user.organizationId,
    };
    return this.jwt.signAsync(payload);
  }

  // Hydrate the public user by email for the Google OAuth flow. Returns null for an
  // unknown or inactive account (Google sign-in is for EXISTING users only).
  async findActiveUserByEmail(email: string): Promise<MeDto | null> {
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
        organizationName: schema.organizations.name,
        active: schema.users.active,
      })
      .from(schema.users)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.users.organizationId),
      )
      .where(eq(schema.users.email, email))
      .limit(1);

    const row = rows[0];
    if (!row || !row.active) return null;
    return {
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
  }

  // Auto-provision a brand-new user for the Google sign-in flow. Used when a Google
  // account on the allowed company domain has no EVERTRUST user yet: create an active
  // EMPLOYEE in the (single-tenant) default organization. No authCredentials row is
  // created — these users authenticate via Google only, never a password. Concurrent
  // first-logins are made safe by the users_email unique index (onConflictDoNothing
  // then re-read the winner).
  async provisionGoogleUser(email: string, name: string): Promise<MeDto> {
    const orgRows = await this.db
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations)
      .orderBy(asc(schema.organizations.createdAt))
      .limit(1);
    const org = orgRows[0];
    if (!org) {
      throw new ServiceUnavailableException(
        'No organization exists to attach the new user to.',
      );
    }

    const inserted = await this.db
      .insert(schema.users)
      .values({
        organizationId: org.id,
        email,
        name,
        role: 'EMPLOYEE',
        active: true,
      })
      .onConflictDoNothing({ target: schema.users.email })
      .returning({ id: schema.users.id });

    // Lost the insert race (a concurrent first-login created the row) — re-read it.
    if (!inserted[0]) {
      const existing = await this.findActiveUserByEmail(email);
      if (!existing) {
        throw new ServiceUnavailableException('Failed to provision Google user.');
      }
      return existing;
    }

    return {
      id: inserted[0].id,
      email,
      name,
      role: 'EMPLOYEE',
      department: null,
      position: null,
      permissions: effectivePermissions('EMPLOYEE', null),
      organizationId: org.id,
      organizationName: org.name,
    };
  }

  // Hydrate the full public user for /auth/me. The JWT only carries id+role, so
  // we read name+email from the source of truth. 401 if the user vanished.
  async me(userId: string): Promise<MeDto> {
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
        organizationName: schema.organizations.name,
      })
      .from(schema.users)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.users.organizationId),
      )
      .where(eq(schema.users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) throw new UnauthorizedException('User no longer exists');
    return {
      ...user,
      permissions: effectivePermissions(user.role, user.permissions),
    };
  }
}

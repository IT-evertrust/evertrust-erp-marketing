import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
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
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      org: user.organizationId,
    };
    const accessToken = await this.jwt.signAsync(payload);

    return { accessToken, user };
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

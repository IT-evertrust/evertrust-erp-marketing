import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { MeDto, UserListItemDto } from '@evertrust/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { UsersService } from './users.service';
import { UpdateMyNameBodyDto } from './users.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Org directory for pickers (e.g. tender assignee). Authenticated-only — NO
  // @RequirePermissions — so any logged-in member can resolve their colleagues;
  // strictly tenant-scoped to the caller's organization.
  @Get()
  list(@OrgId() orgId: string): Promise<UserListItemDto[]> {
    return this.users.listForOrg(orgId);
  }

  // The demo AUDITED mutation. Updates the caller's name, then records the
  // before/after on the request so the global AuditInterceptor writes an
  // audit_log row (entity 'users', entityId = the user id, action UPDATE).
  @Patch('me')
  async updateMyName(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateMyNameBodyDto,
    @Req() req: Request,
  ): Promise<MeDto> {
    const { before, after } = await this.users.updateName(user.id, body.name);

    setAuditContext(req, {
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      before,
      after: { name: after.name },
    });

    return after;
  }
}

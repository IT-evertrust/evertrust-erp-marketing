import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import type {
  EngageReplyListDto,
  EngageScanResultDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { EngageService } from './engage.service';
import { EngageSendBodyDto } from './engage.dto';

// Engage · ERP-DIRECT Gmail reply pipeline. JWT-auth + tenant-scoped (@OrgId),
// gated by the campaigns RBAC (read for the queue, write for scan/send/redraft).
// JwtAuthGuard + PermissionsGuard are global (APP_GUARD) — no @UseGuards here.
// GET /replies and POST /scan degrade to a `configured: false` shell rather than
// erroring; POST /:id/send and /:id/redraft surface a 400 when the row is not in
// the calling org.
@Controller('engage')
export class EngageController {
  constructor(private readonly engage: EngageService) {}

  @RequirePermissions('campaigns:read')
  @Get('replies')
  list(@OrgId() orgId: string): Promise<EngageReplyListDto> {
    return this.engage.list(orgId);
  }

  @RequirePermissions('campaigns:write')
  @Post('scan')
  scan(@OrgId() orgId: string): Promise<EngageScanResultDto> {
    return this.engage.scan(orgId);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/send')
  send(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EngageSendBodyDto,
  ): Promise<EngageReplyListDto> {
    return this.engage.send(orgId, id, body.text);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/redraft')
  redraft(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.redraft(orgId, id);
  }
}

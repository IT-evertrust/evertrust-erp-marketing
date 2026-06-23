import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type {
  ConnectedGoogleAccountDto,
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

  // The org's connected Google mailboxes — feeds the inbox account switcher.
  @RequirePermissions('campaigns:read')
  @Get('accounts')
  accounts(@OrgId() orgId: string): Promise<ConnectedGoogleAccountDto[]> {
    return this.engage.listAccounts(orgId);
  }

  // CAMPAIGN-CENTRIC model: the org's campaigns (Reach AIMs) with lead count + the
  // mailbox each sends from (for inbox scoping).
  @RequirePermissions('campaigns:read')
  @Get('campaigns')
  campaigns(@OrgId() orgId: string) {
    return this.engage.listCampaigns(orgId);
  }

  // A campaign's lead folder: each lead + its client email.
  @RequirePermissions('campaigns:read')
  @Get('campaigns/:aimId/leads')
  campaignLeads(
    @OrgId() orgId: string,
    @Param('aimId', ParseUUIDPipe) aimId: string,
  ) {
    return this.engage.listCampaignLeads(orgId, aimId);
  }

  // The Gmail threads to/from a lead's client `email`, searched in the campaign's
  // mailbox (`accountId`, optional) or the org default. Requires gmail.readonly.
  @RequirePermissions('campaigns:read')
  @Get('threads')
  threads(
    @OrgId() orgId: string,
    @Query('email') email: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.engage.searchLeadThreads(orgId, email ?? '', accountId);
  }

  // `accountId` (optional) targets a specific connected mailbox; omitted = org default.
  @RequirePermissions('campaigns:read')
  @Get('replies')
  list(
    @OrgId() orgId: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.list(orgId, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('scan')
  scan(
    @OrgId() orgId: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageScanResultDto> {
    return this.engage.scan(orgId, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/send')
  send(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EngageSendBodyDto,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.send(orgId, id, body.text, accountId);
  }

  @RequirePermissions('campaigns:write')
  @Post('replies/:id/redraft')
  redraft(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('accountId') accountId?: string,
  ): Promise<EngageReplyListDto> {
    return this.engage.redraft(orgId, id, accountId);
  }
}

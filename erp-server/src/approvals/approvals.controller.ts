import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ApprovalRequestDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { ApprovalsService } from './approvals.service';
import {
  CreateApprovalRequestBodyDto,
  DecideApprovalBodyDto,
} from './approvals.dto';

// Phase 6 (R30) customer-approval gate over HTTP. List + open-request are nested
// under the owning tender; the decision is a standalone action on the approval id
// (mirroring the pricing controller's nested-create / standalone-mutate split).
// All tenant-scoped via the owning tender (404 otherwise). Reads gated by
// approvals:read; opening a request by tenders:write (the PIC runs the tender);
// the DECISION by approvals:decide (L1–L3 — the senior gate). Mutations audited.
@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  // The tender's approval requests (newest-first). Read-only.
  @RequirePermissions('approvals:read')
  @Get('tenders/:tenderId/approvals')
  list(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
  ): Promise<ApprovalRequestDto[]> {
    return this.approvals.listForTender(orgId, tenderId) as unknown as Promise<
      ApprovalRequestDto[]
    >;
  }

  // Open a PENDING approval request on the tender (default type CUSTOMER).
  @RequirePermissions('tenders:write')
  @Post('tenders/:tenderId/approvals')
  async request(
    @OrgId() orgId: string,
    @Param('tenderId', ParseUUIDPipe) tenderId: string,
    @Body() body: CreateApprovalRequestBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ApprovalRequestDto> {
    const approval = await this.approvals.request(
      orgId,
      tenderId,
      body,
      user.id,
    );
    setAuditContext(req, {
      entity: 'approval_requests',
      entityId: approval.id,
      action: 'CREATE',
      after: approval,
    });
    return approval as unknown as ApprovalRequestDto;
  }

  // Record the customer's decision (APPROVED | REJECTED) + evidence. An APPROVED
  // CUSTOMER decision is what unblocks the submission gate. approvals:decide only.
  @RequirePermissions('approvals:decide')
  @Post('approvals/:id/decide')
  async decide(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DecideApprovalBodyDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<ApprovalRequestDto> {
    const { before, after } = await this.approvals.decide(
      orgId,
      id,
      body,
      user.id,
    );
    setAuditContext(req, {
      entity: 'approval_requests',
      entityId: after.id,
      action: 'DECIDE',
      before: { status: before.status },
      after: { status: after.status },
    });
    return after as unknown as ApprovalRequestDto;
  }
}

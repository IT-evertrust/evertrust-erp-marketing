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
import type {
  SubmissionReadinessDto,
  SubmissionReceiptDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { SubmissionService } from './submission.service';
import { SubmitTenderBodyDto } from './submission.dto';

// Phase 7 — tender submission. GET the readiness/gate state (tenders:read) and POST
// the human submission proof (tenders:transition — same authority as a lifecycle
// move). Submit enforces the full gate, logs the receipt and advances to SUBMITTED;
// it's audited as a tender SUBMIT (the receipt id + proof are captured). Tenancy is
// enforced in the service via the owning tender.
@Controller()
export class SubmissionController {
  constructor(private readonly submission: SubmissionService) {}

  @RequirePermissions('tenders:read')
  @Get('tenders/:id/submission')
  readiness(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SubmissionReadinessDto> {
    return this.submission.getReadiness(orgId, id);
  }

  @RequirePermissions('tenders:transition')
  @Post('tenders/:id/submit')
  async submit(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: SubmitTenderBodyDto,
    @Req() req: Request,
  ): Promise<SubmissionReceiptDto> {
    const receipt = await this.submission.submit(orgId, id, user.id, body);
    setAuditContext(req, {
      entity: 'tenders',
      entityId: id,
      action: 'SUBMIT',
      after: {
        status: 'SUBMITTED',
        receiptId: receipt.id,
        proofUrl: receipt.proofUrl,
      },
    });
    return receipt as unknown as SubmissionReceiptDto;
  }
}

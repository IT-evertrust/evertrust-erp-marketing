import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  MarketingDraftListDto,
  ScanLeadsResultDto,
  SendDraftResultDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { setAuditContext } from '../common/audit-context';
import { MarketingService } from './marketing.service';
import { SendDraftBodyDto } from './marketing.dto';

// Marketing · RAG Draft Review. Read = campaigns:read; approve & send (real
// client email) = campaigns:write and AUDITED — a human clicking Send is the
// approval gate, recorded for the audit trail.
@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @RequirePermissions('campaigns:read')
  @Get('drafts')
  listDrafts(): Promise<MarketingDraftListDto> {
    return this.marketing.listDrafts();
  }

  @RequirePermissions('campaigns:write')
  @Post('drafts/send')
  async send(
    @Body() body: SendDraftBodyDto,
    @Req() req: Request,
  ): Promise<SendDraftResultDto> {
    const r = await this.marketing.send(body);
    setAuditContext(req, {
      entity: 'marketing_drafts',
      entityId: r.draftId ?? body.draftId,
      action: 'SEND',
      after: { to: r.to, status: r.status, sentMessageId: r.sentMessageId },
    });
    return r;
  }

  // "Sync from leads" — trigger the RAG Agent to scan every campaign's leads
  // sheet for Status=unsure rows and draft replies (runs async). AUDITED.
  @RequirePermissions('campaigns:write')
  @Post('drafts/scan')
  async scan(@Req() req: Request): Promise<ScanLeadsResultDto> {
    const r = await this.marketing.scanLeads();
    setAuditContext(req, {
      entity: 'marketing_drafts',
      action: 'SCAN',
      after: { ok: r.ok },
    });
    return r;
  }
}

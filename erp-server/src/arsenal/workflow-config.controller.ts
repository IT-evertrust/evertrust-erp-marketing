import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { Request } from 'express';
import type {
  AiEngineConfigDto,
  CalendarListResultDto,
  LeadStatsDto,
  OrgSenderDto,
  RotateIngestTokenResultDto,
  TestN8nResultDto,
  WorkflowConfigDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { WorkflowConfigService } from './workflow-config.service';
import { SendersService } from './senders.service';
import { GoogleCalendarService } from './google-calendar.service';
import {
  MAX_SIGNATURE_BYTES,
  SignatureAssetsService,
} from './signature-assets.service';
import {
  UpdateAiEngineBodyDto,
  UpdateWorkflowConfigBodyDto,
  UpsertOrgSenderBodyDto,
} from './arsenal.dto';

// The JSON body shape for the link-based path: { url: <a valid URL> }. Validated
// manually (not the global ZodValidationPipe) because this route also accepts a
// multipart file, so it can't declare a single createZodDto @Body() type.
const SignatureLinkBody = z.object({ url: z.string().url() });

// Build the ABSOLUTE origin (protocol + host) for the current request, used as the
// base of the public signature-image URL so it hotlinks straight from an email.
// There is no self/base-URL env var (see env.schema.ts), so it is derived from the
// request: the X-Forwarded-Proto header wins when present (behind Render/Vercel's
// TLS-terminating proxy `req.protocol` reports http), else `req.protocol`; the host
// comes from the Host header via Express.
function requestBaseUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : '') ||
    req.protocol;
  const host = req.get('host');
  if (!host) throw new BadRequestException('Cannot resolve request host');
  return `${proto}://${host}`;
}

// Admin control panel for the GLOBAL Growth-Engine workflow config (the n8n wiring
// that is otherwise env-only). Single-tenant app → these edit the one global
// singleton, gated by admin:config (JWT). Secrets are never returned: the read shape
// exposes effective webhook/base-URL values + status flags only. The two admin
// actions live here too: test-n8n probes the n8n public API, and rotate-token mints a
// machine ingest token whose plaintext is returned exactly once (only its hash is
// stored); DELETE ingest-token reverts machine-route auth to the env token.
//
// Empty controller prefix + full method paths (the repo's pattern for routes that
// span more than one top-level segment, e.g. documents/rfq controllers): the config
// routes live under /arsenal/config while lead-stats sits at /arsenal/lead-stats.
@Controller()
export class WorkflowConfigController {
  constructor(
    private readonly workflowConfig: WorkflowConfigService,
    private readonly signatureAssets: SignatureAssetsService,
    private readonly senders: SendersService,
    private readonly calendars: GoogleCalendarService,
  ) {}

  // The resolved config for the Configuration UI: GLOBAL infra (override ?? env) +
  // the caller org's PER-ORG prefs (templates/leads/default sender). `@OrgId()` pulls
  // req.user.organizationId off the JWT.
  @RequirePermissions('admin:config')
  @Get('arsenal/config')
  get(@OrgId() orgId: string): Promise<WorkflowConfigDto> {
    return this.workflowConfig.getEffective(orgId);
  }

  // Org-scoped counts (leads / prospects / suppressions) for the Configuration
  // page's metric strip. `@OrgId()` pulls req.user.organizationId off the JWT.
  @RequirePermissions('admin:config')
  @Get('arsenal/lead-stats')
  leadStats(@OrgId() orgId: string): Promise<LeadStatsDto> {
    return this.workflowConfig.getLeadStats(orgId);
  }

  // Apply a partial override (a value sets it, null/"" clears it back to env/default,
  // an omitted field is unchanged); INFRA fields write the global singleton, PREF
  // fields write the caller org's org_config row. Returns the freshly resolved config.
  // Audited.
  @RequirePermissions('admin:config')
  @Put('arsenal/config')
  async update(
    @Body() body: UpdateWorkflowConfigBodyDto,
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<WorkflowConfigDto> {
    const after = await this.workflowConfig.update(body, orgId);
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'UPDATE',
      after,
    });
    return after;
  }

  // The caller org's resolved AI engine config (per-org model + gateway, each null when
  // unset → product default). Read-only → not audited.
  @RequirePermissions('admin:config')
  @Get('arsenal/config/ai-engine')
  getAiEngine(@OrgId() orgId: string): Promise<AiEngineConfigDto> {
    return this.workflowConfig.getAiEngine(orgId);
  }

  // Apply a partial AI engine update (a value sets it, null/"" clears it to the product
  // default, an omitted field is unchanged) on the caller org's org_config row. Returns
  // the freshly resolved config. Audited.
  @RequirePermissions('admin:config')
  @Put('arsenal/config/ai-engine')
  async updateAiEngine(
    @Body() body: UpdateAiEngineBodyDto,
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<AiEngineConfigDto> {
    const after = await this.workflowConfig.updateAiEngine(orgId, body);
    setAuditContext(req, {
      entity: 'org_config',
      action: 'UPDATE',
      after,
    });
    return after;
  }

  // The caller org's RESOLVED sender list (its own org_senders rows, or the product
  // DEFAULT_SENDERS when it has none). Read-only → not audited.
  @RequirePermissions('admin:config')
  @Get('arsenal/config/senders')
  listSenders(@OrgId() orgId: string): Promise<OrgSenderDto[]> {
    return this.senders.list(orgId);
  }

  // Live scan of the caller org's Google Calendars for the AIM Lock & Load Calendar
  // dropdown. The service resolves the org's default connected Calendar account first
  // (per-org token), falling back to the deployment-wide token for back-compat — so each
  // tenant sees only its OWN calendars. The service never throws — `configured: false`
  // means the UI degrades to the org-default calendar. Read-only → not audited.
  @RequirePermissions('admin:config')
  @Get('arsenal/config/calendars')
  listCalendars(@OrgId() orgId: string): Promise<CalendarListResultDto> {
    return this.calendars.listCalendars(orgId);
  }

  // Upsert a PER-ORG sender on (organizationId, key). When isDefault is set, the flag
  // is cleared on the org's other senders in the same write so at most one default
  // exists. Returns the resolved list. Audited.
  @RequirePermissions('admin:config')
  @Post('arsenal/config/senders')
  async upsertSender(
    @Body() body: UpsertOrgSenderBodyDto,
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<OrgSenderDto[]> {
    const senders = await this.senders.upsert(orgId, body);
    setAuditContext(req, {
      entity: 'org_senders',
      action: 'UPSERT',
      after: { key: body.key, email: body.email, isDefault: body.isDefault ?? false },
    });
    return senders;
  }

  // Remove a PER-ORG sender by its key. Guarded: the last remaining sender cannot be
  // deleted (409). Returns the resolved list. Audited.
  @RequirePermissions('admin:config')
  @Delete('arsenal/config/senders/:key')
  async deleteSender(
    @Param('key') key: string,
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<OrgSenderDto[]> {
    const senders = await this.senders.remove(orgId, key);
    setAuditContext(req, {
      entity: 'org_senders',
      action: 'DELETE',
      after: { key },
    });
    return senders;
  }

  // Probe the n8n public API with the resolved base URL + env key. Read-only (never
  // mutates config, never throws) → not audited; failures surface in `detail`.
  @RequirePermissions('admin:config')
  @Post('arsenal/config/test-n8n')
  testN8n(): Promise<TestN8nResultDto> {
    return this.workflowConfig.testN8nConnection();
  }

  // Mint a fresh machine ingest token. The plaintext is returned ONCE; only its hash
  // is persisted. Audited (entity workflow_config, action ROTATE) WITHOUT the token
  // value — the audit payload must never carry the secret.
  @RequirePermissions('admin:config')
  @Post('arsenal/config/rotate-token')
  async rotateToken(@Req() req: Request): Promise<RotateIngestTokenResultDto> {
    const { token, setAt } = await this.workflowConfig.rotateIngestToken();
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'ROTATE',
      after: { ingestTokenSetAt: setAt.toISOString() },
    });
    return { token, setAt: setAt.toISOString() };
  }

  // Clear the rotated ingest token, reverting machine-route auth to the env
  // ARSENAL_INGEST_TOKEN. Returns the freshly resolved config (mirrors PUT). Audited.
  @RequirePermissions('admin:config')
  @Delete('arsenal/config/ingest-token')
  async clearIngestToken(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<WorkflowConfigDto> {
    await this.workflowConfig.clearIngestToken();
    const after = await this.workflowConfig.getEffective(orgId);
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'CLEAR_TOKEN',
      after,
    });
    return after;
  }

  // Set the caller org's signature image. Accepts EITHER a multipart `file` (stored
  // as a signature_assets row; signatureImageUrl → the absolute public serve URL) OR
  // a JSON body { url } (normalized via driveImageUrl and stored directly, no asset
  // row). The file uses in-memory multer storage so the bytes are base64-encoded into
  // the DB (no disk write — unlike the document uploads). Returns { signatureImageUrl }.
  // Audited.
  @RequirePermissions('admin:config')
  @Post('arsenal/config/signature-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIGNATURE_BYTES },
    }),
  )
  async setSignatureImage(
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ signatureImageUrl: string }> {
    let result: { signatureImageUrl: string };
    if (file) {
      result = await this.signatureAssets.storeUpload(
        orgId,
        {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        },
        requestBaseUrl(req),
      );
    } else {
      // No file → expect a JSON { url }. Validate manually (the route also serves
      // multipart, so it can't use a single createZodDto @Body() type).
      const parsed = SignatureLinkBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new BadRequestException(
          'Provide a multipart `file` or a JSON body { url } with a valid URL',
        );
      }
      result = await this.signatureAssets.setLink(orgId, parsed.data.url);
    }

    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'UPDATE',
      after: { signatureImageUrl: result.signatureImageUrl },
    });
    return result;
  }

  // Clear the caller org's signature image (null on org_config.signatureImageUrl).
  // Does not delete stored asset rows. Audited.
  @RequirePermissions('admin:config')
  @Delete('arsenal/config/signature-image')
  async clearSignatureImage(
    @OrgId() orgId: string,
    @Req() req: Request,
  ): Promise<{ signatureImageUrl: null }> {
    await this.signatureAssets.clear(orgId);
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'UPDATE',
      after: { signatureImageUrl: null },
    });
    return { signatureImageUrl: null };
  }
}

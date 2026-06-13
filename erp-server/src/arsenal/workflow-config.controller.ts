import { Body, Controller, Delete, Get, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import type {
  LeadStatsDto,
  RotateIngestTokenResultDto,
  TestN8nResultDto,
  WorkflowConfigDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { WorkflowConfigService } from './workflow-config.service';
import { UpdateWorkflowConfigBodyDto } from './arsenal.dto';

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
  constructor(private readonly workflowConfig: WorkflowConfigService) {}

  // The resolved config (stored override ?? env per field) for the Configuration UI.
  @RequirePermissions('admin:config')
  @Get('arsenal/config')
  get(): Promise<WorkflowConfigDto> {
    return this.workflowConfig.getEffective();
  }

  // Org-scoped counts (leads / prospects / suppressions) for the Configuration
  // page's metric strip. `@OrgId()` pulls req.user.organizationId off the JWT.
  @RequirePermissions('admin:config')
  @Get('arsenal/lead-stats')
  leadStats(@OrgId() orgId: string): Promise<LeadStatsDto> {
    return this.workflowConfig.getLeadStats(orgId);
  }

  // Apply a partial override (a value sets it, null/"" clears it back to env, an
  // omitted field is unchanged); returns the freshly resolved config. Audited.
  @RequirePermissions('admin:config')
  @Put('arsenal/config')
  async update(
    @Body() body: UpdateWorkflowConfigBodyDto,
    @Req() req: Request,
  ): Promise<WorkflowConfigDto> {
    const after = await this.workflowConfig.update(body);
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'UPDATE',
      after,
    });
    return after;
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
  async clearIngestToken(@Req() req: Request): Promise<WorkflowConfigDto> {
    await this.workflowConfig.clearIngestToken();
    const after = await this.workflowConfig.getEffective();
    setAuditContext(req, {
      entity: 'workflow_config',
      action: 'CLEAR_TOKEN',
      after,
    });
    return after;
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type {
  AssignmentDto,
  TenderDeadlineRiskDto,
  TenderDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { TendersService } from './tenders.service';
import { AssignmentsService } from './assignments.service';
import {
  AssignTenderBodyDto,
  CreateTenderBodyDto,
  ListTendersQueryDto,
  TransitionTenderBodyDto,
  UpdateTenderBodyDto,
} from './tenders.dto';

// Tenant-scoped, permission-gated tender CRUD + lifecycle transitions. Tenancy
// comes from @OrgId() (the JWT's org), never from the client. Mutations stamp the
// request via setAuditContext so the global AuditInterceptor writes the
// audit_log row (entity 'tenders', entityId = the tender id).
@Controller('tenders')
export class TendersController {
  constructor(
    private readonly tenders: TendersService,
    private readonly assignments: AssignmentsService,
  ) {}

  @RequirePermissions('tenders:read')
  @Get()
  list(
    @OrgId() orgId: string,
    @Query() query: ListTendersQueryDto,
  ): Promise<TenderDto[]> {
    // The service returns Drizzle rows (Date timestamps); Nest JSON-serializes
    // them to the TenderDto wire shape (ISO strings) at the HTTP boundary.
    return this.tenders.list(orgId, query.status) as unknown as Promise<
      TenderDto[]
    >;
  }

  // Phase 6 (R31): the org's deadline at-risk worklist (most urgent first).
  // Declared BEFORE :id — otherwise the ParseUUIDPipe on :id would 400 this
  // static path before it could route here.
  @RequirePermissions('tenders:read')
  @Get('deadline-risk')
  deadlineRisk(@OrgId() orgId: string): Promise<TenderDeadlineRiskDto[]> {
    return this.tenders.deadlineRisk(orgId) as unknown as Promise<
      TenderDeadlineRiskDto[]
    >;
  }

  @RequirePermissions('tenders:read')
  @Get(':id')
  get(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TenderDto> {
    return this.tenders.get(orgId, id) as unknown as Promise<TenderDto>;
  }

  @RequirePermissions('tenders:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateTenderBodyDto,
    @Req() req: Request,
  ): Promise<TenderDto> {
    const tender = await this.tenders.create(orgId, body);
    setAuditContext(req, {
      entity: 'tenders',
      entityId: tender.id,
      action: 'CREATE',
      after: tender,
    });
    return tender as unknown as TenderDto;
  }

  @RequirePermissions('tenders:write')
  @Patch(':id')
  async update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTenderBodyDto,
    @Req() req: Request,
  ): Promise<TenderDto> {
    const { before, after } = await this.tenders.update(orgId, id, body);
    setAuditContext(req, {
      entity: 'tenders',
      entityId: after.id,
      action: 'UPDATE',
      before,
      after,
    });
    return after as unknown as TenderDto;
  }

  @RequirePermissions('tenders:transition')
  @Post(':id/transition')
  async transition(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: TransitionTenderBodyDto,
    @Req() req: Request,
  ): Promise<TenderDto> {
    const { before, after } = await this.tenders.transition(orgId, id, body.to);
    setAuditContext(req, {
      entity: 'tenders',
      entityId: after.id,
      action: 'TRANSITION',
      before: { status: before.status },
      after: { status: after.status },
    });
    return after as unknown as TenderDto;
  }

  // The current ACTIVE assignment of the tender, or null when unassigned.
  @RequirePermissions('tenders:read')
  @Get(':id/assignment')
  getAssignment(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AssignmentDto | null> {
    return this.assignments.getActive(orgId, id);
  }

  // Manually assign the tender to a PIC (Phase 4 / R21). Supersedes any prior
  // ACTIVE assignment. 404 if the tender is not in the org; 400 if picId is not
  // a user in the same org. Audited (entity 'tenders', action 'ASSIGN').
  @RequirePermissions('tenders:assign')
  @Post(':id/assign')
  async assign(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AssignTenderBodyDto,
    @Req() req: Request,
  ): Promise<AssignmentDto> {
    const assignment = await this.assignments.assign(
      orgId,
      id,
      body.picId,
      body.reason,
    );
    setAuditContext(req, {
      entity: 'tenders',
      entityId: id,
      action: 'ASSIGN',
      after: assignment,
    });
    return assignment;
  }
}

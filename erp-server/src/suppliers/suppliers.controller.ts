import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SupplierDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierBodyDto,
  UpdateSupplierBodyDto,
} from './suppliers.dto';

// Tenant-scoped, permission-gated supplier registry CRUD. Mutations are audited
// via setAuditContext (entity 'suppliers').
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @RequirePermissions('suppliers:read')
  @Get()
  list(@OrgId() orgId: string): Promise<SupplierDto[]> {
    // Service returns Drizzle rows (Date timestamps); Nest serializes to the
    // SupplierDto wire shape (ISO strings) at the HTTP boundary.
    return this.suppliers.list(orgId) as unknown as Promise<SupplierDto[]>;
  }

  @RequirePermissions('suppliers:read')
  @Get(':id')
  get(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SupplierDto> {
    return this.suppliers.get(orgId, id) as unknown as Promise<SupplierDto>;
  }

  @RequirePermissions('suppliers:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateSupplierBodyDto,
    @Req() req: Request,
  ): Promise<SupplierDto> {
    const supplier = await this.suppliers.create(orgId, body);
    setAuditContext(req, {
      entity: 'suppliers',
      entityId: supplier.id,
      action: 'CREATE',
      after: supplier,
    });
    return supplier as unknown as SupplierDto;
  }

  @RequirePermissions('suppliers:write')
  @Patch(':id')
  async update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSupplierBodyDto,
    @Req() req: Request,
  ): Promise<SupplierDto> {
    const { before, after } = await this.suppliers.update(orgId, id, body);
    setAuditContext(req, {
      entity: 'suppliers',
      entityId: after.id,
      action: 'UPDATE',
      before,
      after,
    });
    return after as unknown as SupplierDto;
  }
}

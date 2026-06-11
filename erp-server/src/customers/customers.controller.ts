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
import type { CustomerDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import { CustomersService } from './customers.service';
import {
  CreateCustomerBodyDto,
  UpdateCustomerBodyDto,
} from './customers.dto';

// Tenant-scoped, permission-gated customer registry CRUD. Mutations are audited
// via setAuditContext (entity 'customers').
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @RequirePermissions('customers:read')
  @Get()
  list(@OrgId() orgId: string): Promise<CustomerDto[]> {
    // Service returns Drizzle rows (Date timestamps); Nest serializes to the
    // CustomerDto wire shape (ISO strings) at the HTTP boundary.
    return this.customers.list(orgId) as unknown as Promise<CustomerDto[]>;
  }

  @RequirePermissions('customers:read')
  @Get(':id')
  get(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerDto> {
    return this.customers.get(orgId, id) as unknown as Promise<CustomerDto>;
  }

  @RequirePermissions('customers:write')
  @Post()
  async create(
    @OrgId() orgId: string,
    @Body() body: CreateCustomerBodyDto,
    @Req() req: Request,
  ): Promise<CustomerDto> {
    const customer = await this.customers.create(orgId, body);
    setAuditContext(req, {
      entity: 'customers',
      entityId: customer.id,
      action: 'CREATE',
      after: customer,
    });
    return customer as unknown as CustomerDto;
  }

  @RequirePermissions('customers:write')
  @Patch(':id')
  async update(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerBodyDto,
    @Req() req: Request,
  ): Promise<CustomerDto> {
    const { before, after } = await this.customers.update(orgId, id, body);
    setAuditContext(req, {
      entity: 'customers',
      entityId: after.id,
      action: 'UPDATE',
      before,
      after,
    });
    return after as unknown as CustomerDto;
  }
}

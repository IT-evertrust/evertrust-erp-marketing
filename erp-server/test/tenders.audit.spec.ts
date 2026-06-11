import { lastValueFrom, of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { schema } from '@evertrust/db';
import { TendersController } from '../src/tenders/tenders.controller';
import { TendersService } from '../src/tenders/tenders.service';
import { AssignmentsService } from '../src/tenders/assignments.service';
import { AuditInterceptor } from '../src/common/audit.interceptor';
import type { AuthUser } from '../src/auth/auth.types';
import { getAuditContext } from '../src/common/audit-context';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const T_A = 'a1111111-1111-1111-1111-111111111111';
const PIC: AuthUser = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', role: 'EMPLOYEE', organizationId: ORG_A };

// A no-op PinoLogger stub (the interceptor only logs on skip/error paths).
const loggerStub = {
  setContext: () => undefined,
  debug: () => undefined,
  error: () => undefined,
} as never;

// Build a request object carrying the authenticated principal, like the real
// stack does after JwtAuthGuard.
function makeReq(method: string, path: string): Request {
  return { method, path, headers: {}, user: PIC } as unknown as Request;
}

// Run the AuditInterceptor over a request whose handler succeeds, so its
// post-success write() path fires. Returns once the tap side-effect resolves.
async function runInterceptor(
  interceptor: AuditInterceptor,
  req: Request,
): Promise<void> {
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of({ ok: true }) };
  await lastValueFrom(interceptor.intercept(ctx, next));
  // tap fires synchronously on emit; the async write resolves on next microtasks
  await new Promise((r) => setTimeout(r, 0));
}

function setup() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      status: 'PIC_PRICING',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
  ]);
  const auditLog = new FakeTable([]);
  const tableMap = new Map<unknown, FakeTable>([
    [schema.tenders, tenders],
    [schema.auditLog, auditLog],
  ]);
  const { db } = makeFakeDb(tableMap);
  const controller = new TendersController(
    new TendersService(db),
    new AssignmentsService(db),
  );
  const interceptor = new AuditInterceptor(db, loggerStub);
  return { controller, interceptor, auditLog };
}

// WHY: doctrine — every mutation is auditable (Workflow -> API -> DB -> Audit).
// A create/transition that does NOT leave an audit_log row is an observability
// failure. These prove the controller stamps the context AND the interceptor
// persists the org-stamped row.
describe('tenders auditing', () => {
  it('writes an audit_log row on tender create (entity tenders, action CREATE)', async () => {
    const { controller, interceptor, auditLog } = setup();
    const req = makeReq('POST', '/tenders');

    const created = await controller.create(
      ORG_A,
      { vergabeId: 'NEW-1', source: 'PORTAL', title: 'Fresh' } as never,
      req,
    );

    // controller recorded the audit context on the request...
    expect(getAuditContext(req)).toMatchObject({
      entity: 'tenders',
      entityId: created.id,
      action: 'CREATE',
    });

    // ...and the interceptor persists exactly one matching row, org-stamped.
    await runInterceptor(interceptor, req);
    expect(auditLog.rows).toHaveLength(1);
    expect(auditLog.rows[0]).toMatchObject({
      entity: 'tenders',
      entityId: created.id,
      action: 'CREATE',
      actorType: 'USER',
      actorId: PIC.id,
      organizationId: ORG_A,
    });
  });

  it('writes an audit_log row on transition with before/after status', async () => {
    const { controller, interceptor, auditLog } = setup();
    const req = makeReq('POST', `/tenders/${T_A}/transition`);

    await controller.transition(
      ORG_A,
      T_A,
      { to: 'CUSTOMER_PRICING' } as never,
      req,
    );

    await runInterceptor(interceptor, req);
    expect(auditLog.rows).toHaveLength(1);
    expect(auditLog.rows[0]).toMatchObject({
      entity: 'tenders',
      entityId: T_A,
      action: 'TRANSITION',
      organizationId: ORG_A,
      before: { status: 'PIC_PRICING' },
      after: { status: 'CUSTOMER_PRICING' },
    });
  });
});

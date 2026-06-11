import type { Request } from 'express';

// What a handler can declare about the mutation it performed, so the global
// AuditInterceptor can persist a faithful audit_log row. Everything is optional;
// the interceptor fills sensible defaults (route path as entity) when omitted.
export interface AuditContext {
  entity?: string;
  entityId?: string | null;
  action?: string;
  before?: unknown;
  after?: unknown;
}

const AUDIT_KEY = '__auditContext' as const;

type WithAudit = Request & { [AUDIT_KEY]?: AuditContext };

// Merge audit details onto the current request. Called from controllers/services
// after a successful mutation (e.g. PATCH /users/me records before/after name).
export function setAuditContext(req: Request, ctx: AuditContext): void {
  const r = req as WithAudit;
  r[AUDIT_KEY] = { ...r[AUDIT_KEY], ...ctx };
}

export function getAuditContext(req: Request): AuditContext | undefined {
  return (req as WithAudit)[AUDIT_KEY];
}

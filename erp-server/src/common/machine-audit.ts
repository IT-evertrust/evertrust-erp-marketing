import { schema } from '@evertrust/db';
import type { DbClient } from '../db/db.tokens';

// Shared writer for n8n→ERP MACHINE writes. The global AuditInterceptor only writes
// audit_log for JWT (USER) requests; machine routes are @Public() and carry no
// principal, so each machine WRITE records its own row here with actorType 'N8N'
// (mirrors ArsenalService.recordCallback's original inline audit). actorId is null
// (no user). organizationId is REQUIRED — audit_log.organization_id is NOT NULL, so
// callers must resolve the tenant (from the campaign/prospect) before auditing.
//
// Audit failures are operational signal but must NOT fail the ingest the row records
// — they are swallowed here (the write itself already succeeded). Kept dependency-
// free (a plain function, not a Nest provider) so any machine service can call it.
export async function writeMachineAudit(
  db: DbClient,
  input: {
    organizationId: string;
    entity: string;
    entityId: string;
    action: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      organizationId: input.organizationId,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      actorType: 'N8N',
      actorId: null,
      before: (input.before ?? null) as never,
      after: (input.after ?? null) as never,
      correlationId: null,
    });
  } catch {
    // Never let an audit failure break the machine write it is recording.
  }
}

// Google Drive folder web URL from its file id (the documents.storageUrl
// convention). Used when a campaign acquires its Ammo Forge folder lazily via the
// arsenal callback — n8n sends the id, the ERP derives the link.
export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

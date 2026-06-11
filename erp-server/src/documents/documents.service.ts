import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import type { DocumentDto, DocumentType } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { tenantScope } from '../common/tenant';

// Metadata to persist for a freshly uploaded file. The bytes already live on disk
// (multer wrote them); we only record the row that points at them.
export interface NewDocumentInput {
  type: DocumentType;
  kind?: string;
  storageUrl: string;
  originalName: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedBy: string;
}

// Document loaded for download: the row's identity columns the controller needs
// to stream the file (storageUrl is the on-disk filename under UPLOAD_DIR).
export interface DownloadableDocument {
  storageUrl: string;
  originalName: string;
  mimeType: string | null;
}

// TYPE 1 (and later TYPE 2) tender documents. Tenancy is inherited from the
// parent tender; every method re-verifies the tender is in the caller's org.
@Injectable()
export class DocumentsService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  // 404 unless the tender exists in the caller's org.
  private async assertTenderInOrg(orgId: string, tenderId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.tenders.id })
      .from(schema.tenders)
      .where(
        and(
          tenantScope(orgId, schema.tenders),
          eq(schema.tenders.id, tenderId),
        ),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException('Tender not found');
  }

  // Documents for a tender, newest first. 404 if the tender is missing/other-org.
  async listForTender(orgId: string, tenderId: string): Promise<DocumentDto[]> {
    await this.assertTenderInOrg(orgId, tenderId);
    return this.db
      .select({
        id: schema.documents.id,
        tenderId: schema.documents.tenderId,
        type: schema.documents.type,
        kind: schema.documents.kind,
        originalName: schema.documents.originalName,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        ocrStatus: schema.documents.ocrStatus,
        uploadedBy: schema.documents.uploadedBy,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.tenderId, tenderId))
      .orderBy(desc(schema.documents.createdAt)) as unknown as Promise<
      DocumentDto[]
    >;
  }

  // Insert a documents row for an uploaded file. The tender is re-checked here so
  // a file can never be attached to a tender outside the caller's org. ocrStatus
  // starts PENDING (parsing is a later phase).
  async create(
    orgId: string,
    tenderId: string,
    input: NewDocumentInput,
  ): Promise<DocumentDto> {
    await this.assertTenderInOrg(orgId, tenderId);

    const inserted = await this.db
      .insert(schema.documents)
      .values({
        tenderId,
        type: input.type,
        kind: input.kind ?? null,
        storageUrl: input.storageUrl,
        originalName: input.originalName,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        ocrStatus: 'PENDING',
        uploadedBy: input.uploadedBy,
      })
      .returning({
        id: schema.documents.id,
        tenderId: schema.documents.tenderId,
        type: schema.documents.type,
        kind: schema.documents.kind,
        originalName: schema.documents.originalName,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        ocrStatus: schema.documents.ocrStatus,
        uploadedBy: schema.documents.uploadedBy,
        createdAt: schema.documents.createdAt,
      });

    const row = inserted[0];
    if (!row) throw new Error('Failed to create document');
    return row as unknown as DocumentDto;
  }

  // Load a document for download, enforcing tenant isolation via its parent
  // tender's org. Two scoped lookups (no join, for testability): fetch the doc,
  // then confirm its tender is in the caller's org. 404 if the document is
  // missing OR its tender is not in the caller's org (cross-org == missing).
  async getForDownload(
    orgId: string,
    docId: string,
  ): Promise<DownloadableDocument> {
    const docRows = await this.db
      .select({
        tenderId: schema.documents.tenderId,
        storageUrl: schema.documents.storageUrl,
        originalName: schema.documents.originalName,
        mimeType: schema.documents.mimeType,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, docId))
      .limit(1);

    const doc = docRows[0];
    if (!doc) throw new NotFoundException('Document not found');

    const tenderRows = await this.db
      .select({ id: schema.tenders.id })
      .from(schema.tenders)
      .where(
        and(
          tenantScope(orgId, schema.tenders),
          eq(schema.tenders.id, doc.tenderId),
        ),
      )
      .limit(1);

    // Document exists but belongs to a tender outside the caller's org -> 404,
    // indistinguishable from "missing" (no cross-tenant existence leak).
    if (!tenderRows[0]) throw new NotFoundException('Document not found');

    return {
      storageUrl: doc.storageUrl,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
    };
  }
}

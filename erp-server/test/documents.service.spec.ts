import { NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { DocumentsService } from '../src/documents/documents.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TENDER_A = 'a1111111-1111-1111-1111-111111111111';
const USER_A = 'c1111111-1111-1111-1111-111111111111';
const DOC_A = 'f1111111-1111-1111-1111-111111111111';

function seeded(initialDocs: Record<string, unknown>[] = []) {
  const tenders = new FakeTable([
    { id: TENDER_A, organizationId: ORG_A, title: 'Org A tender', __seq: 1 },
  ]);
  const documents = new FakeTable(initialDocs);
  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.documents, documents],
    ]),
  );
  return { service: new DocumentsService(db), documents };
}

describe('DocumentsService — create', () => {
  // WHY (R22): a TYPE 1 upload persists exactly one documents row pointing at the
  // stored file, in PENDING OCR state, attributed to the uploader.
  it('inserts a documents row for an uploaded file', async () => {
    const { service, documents } = seeded();

    const doc = await service.create(ORG_A, TENDER_A, {
      type: 'TYPE1',
      kind: 'LV',
      storageUrl: 'abc.pdf',
      originalName: 'Leistungsverzeichnis.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
      uploadedBy: USER_A,
    });

    expect(doc.type).toBe('TYPE1');
    expect(doc.originalName).toBe('Leistungsverzeichnis.pdf');
    expect(doc.sizeBytes).toBe(1234);
    expect(doc.ocrStatus).toBe('PENDING');
    expect(doc.uploadedBy).toBe(USER_A);
    expect(documents.rows).toHaveLength(1);
    expect(documents.rows[0]!.storageUrl).toBe('abc.pdf');
  });

  // WHY: a file may never be attached to a tender outside the caller's org.
  it('throws NotFound when the tender is in another org', async () => {
    const { service, documents } = seeded();
    await expect(
      service.create(ORG_B, TENDER_A, {
        type: 'TYPE1',
        storageUrl: 'x.pdf',
        originalName: 'x.pdf',
        uploadedBy: USER_A,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(documents.rows).toHaveLength(0);
  });
});

describe('DocumentsService — getForDownload (tenant isolation)', () => {
  function withDoc() {
    return seeded([
      {
        id: DOC_A,
        tenderId: TENDER_A,
        type: 'TYPE1',
        kind: null,
        storageUrl: 'stored-uuid.pdf',
        originalName: 'original.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        ocrStatus: 'PENDING',
        uploadedBy: USER_A,
        __seq: 1,
      },
    ]);
  }

  it('returns the file metadata for the owning org', async () => {
    const { service } = withDoc();
    const dl = await service.getForDownload(ORG_A, DOC_A);
    expect(dl.storageUrl).toBe('stored-uuid.pdf');
    expect(dl.originalName).toBe('original.pdf');
    expect(dl.mimeType).toBe('application/pdf');
  });

  // WHY: the document exists, but its tender is in org A — org B must get 404,
  // never the file (cross-org existence must not leak).
  it('throws NotFound when the document tender is in another org', async () => {
    const { service } = withDoc();
    await expect(service.getForDownload(ORG_B, DOC_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFound for a missing document id', async () => {
    const { service } = withDoc();
    await expect(
      service.getForDownload(ORG_A, 'f9999999-9999-9999-9999-999999999999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { schema } from '@evertrust/db';
import { qcRequired, submissionBlockers } from '@evertrust/shared';
import { SubmissionService } from '../src/submission/submission.service';
import { PricingTenantService } from '../src/pricing/pricing-tenant.service';
import { FakeTable, makeFakeDb } from './fake-db';

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const T_A = 'a1111111-1111-1111-1111-111111111111';
const T_B = 'b2222222-2222-2222-2222-222222222222';
const LI_A = 'c1111111-1111-1111-1111-111111111111';
const USER = 'e1111111-1111-1111-1111-111111111111';

// ---- Pure gate predicates ------------------------------------------------

describe('qcRequired (Phase 7 R34)', () => {
  it('routine tender (no triggers) does not require QC', () => {
    const r = qcRequired({
      isAboveThreshold: false,
      highRisk: false,
      qcRequested: false,
    });
    expect(r.required).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('requires QC when above the EU threshold (high-value)', () => {
    expect(
      qcRequired({ isAboveThreshold: true, highRisk: false, qcRequested: false })
        .required,
    ).toBe(true);
  });

  it('requires QC when pricing is high-risk', () => {
    expect(
      qcRequired({ isAboveThreshold: false, highRisk: true, qcRequested: false })
        .required,
    ).toBe(true);
  });

  it('requires QC when a QC review was explicitly opened', () => {
    const r = qcRequired({
      isAboveThreshold: false,
      highRisk: false,
      qcRequested: true,
    });
    expect(r.required).toBe(true);
    expect(r.reasons.length).toBe(1);
  });
});

describe('submissionBlockers (Phase 7)', () => {
  const ready = {
    status: 'DOCUMENTS' as const,
    hasCustomerApproval: true,
    qcRequired: false,
    hasApprovedQc: false,
  };

  it('is empty (ready) for a DOCUMENTS tender with customer approval and no QC needed', () => {
    expect(submissionBlockers(ready)).toEqual([]);
  });

  it('blocks when the tender is not in DOCUMENTS', () => {
    expect(submissionBlockers({ ...ready, status: 'PIC_PRICING' }).length).toBe(1);
  });

  it('blocks when there is no customer approval', () => {
    expect(
      submissionBlockers({ ...ready, hasCustomerApproval: false }),
    ).toContainEqual(expect.stringContaining('customer approval'));
  });

  it('blocks when QC is required but not approved, and clears once QC is approved', () => {
    expect(
      submissionBlockers({ ...ready, qcRequired: true, hasApprovedQc: false }),
    ).toContainEqual(expect.stringContaining('QC review required'));
    expect(
      submissionBlockers({ ...ready, qcRequired: true, hasApprovedQc: true }),
    ).toEqual([]);
  });
});

// ---- SubmissionService ---------------------------------------------------

function seed() {
  const tenders = new FakeTable([
    {
      id: T_A,
      organizationId: ORG_A,
      vergabeId: 'EXT-A',
      source: 'PORTAL',
      title: 'Org A tender',
      status: 'DOCUMENTS',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      __seq: 1,
    },
    {
      id: T_B,
      organizationId: ORG_B,
      vergabeId: 'EXT-B',
      source: 'PORTAL',
      title: 'Org B tender',
      status: 'DOCUMENTS',
      currency: 'EUR',
      isAboveThreshold: false,
      createdAt: new Date('2026-01-02T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      __seq: 2,
    },
  ]);
  const approvalRequests = new FakeTable([]);
  const lineItems = new FakeTable([]);
  const priceObservations = new FakeTable([]);
  const documents = new FakeTable([]);
  const submissionReceipts = new FakeTable([]);

  const { db } = makeFakeDb(
    new Map<unknown, FakeTable>([
      [schema.tenders, tenders],
      [schema.approvalRequests, approvalRequests],
      [schema.lineItems, lineItems],
      [schema.priceObservations, priceObservations],
      [schema.documents, documents],
      [schema.submissionReceipts, submissionReceipts],
    ]),
  );
  return {
    service: new SubmissionService(db, new PricingTenantService(db)),
    tenders,
    approvalRequests,
    lineItems,
    priceObservations,
    documents,
    submissionReceipts,
  };
}

function pushApproval(
  tbl: FakeTable,
  type: string,
  status = 'APPROVED',
  seq = 1,
) {
  tbl.rows.push({ id: `appr-${type}-${seq}`, tenderId: T_A, type, status, __seq: seq });
}

function pushDoc(tbl: FakeTable, name: string, seq: number) {
  tbl.rows.push({
    id: `doc-${seq}`,
    tenderId: T_A,
    type: 'TYPE2',
    originalName: name,
    storageUrl: `${seq}.pdf`,
    ocrStatus: 'PENDING',
    createdAt: new Date(),
    __seq: seq,
  });
}

describe('SubmissionService — readiness', () => {
  it('a routine tender with no customer approval is NOT ready (blocked on approval)', async () => {
    const { service } = seed();
    const r = await service.getReadiness(ORG_A, T_A);
    expect(r.hasCustomerApproval).toBe(false);
    expect(r.qcRequired).toBe(false);
    expect(r.canSubmit).toBe(false);
    expect(r.blockers).toContainEqual(expect.stringContaining('customer approval'));
  });

  it('becomes ready once a customer approval is APPROVED; lists the documents', async () => {
    const { service, approvalRequests, documents } = seed();
    pushApproval(approvalRequests, 'CUSTOMER');
    pushDoc(documents, 'Angebot.pdf', 1);
    pushDoc(documents, 'LV.x83', 2);

    const r = await service.getReadiness(ORG_A, T_A);
    expect(r.canSubmit).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.documents).toEqual(['Angebot.pdf', 'LV.x83']);
  });

  it('404s for a tender in another org', async () => {
    const { service } = seed();
    await expect(service.getReadiness(ORG_B, T_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SubmissionService — submit', () => {
  it('rejects when blocked (no customer approval): no receipt, status unchanged', async () => {
    const { service, submissionReceipts, tenders } = seed();
    await expect(
      service.submit(ORG_A, T_A, USER, { proofUrl: 'portal#123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(submissionReceipts.rows).toHaveLength(0);
    expect(tenders.rows[0]!.status).toBe('DOCUMENTS');
  });

  it('submits once ready: writes a receipt (proof + file-list snapshot) and advances to SUBMITTED', async () => {
    const { service, approvalRequests, documents, submissionReceipts, tenders } =
      seed();
    pushApproval(approvalRequests, 'CUSTOMER');
    pushDoc(documents, 'Angebot.pdf', 1);
    pushDoc(documents, 'LV.x83', 2);

    const receipt = await service.submit(ORG_A, T_A, USER, {
      proofUrl: 'portal-receipt-9988',
    });

    expect(receipt).toMatchObject({
      tenderId: T_A,
      submittedBy: USER,
      proofUrl: 'portal-receipt-9988',
      fileList: ['Angebot.pdf', 'LV.x83'], // server snapshot of the documents
    });
    expect(submissionReceipts.rows).toHaveLength(1);
    expect(tenders.rows[0]!.status).toBe('SUBMITTED');
  });

  it('honours an explicit fileList override', async () => {
    const { service, approvalRequests } = seed();
    pushApproval(approvalRequests, 'CUSTOMER');
    const receipt = await service.submit(ORG_A, T_A, USER, {
      proofUrl: 'p',
      fileList: ['final-bid.zip'],
    });
    expect(receipt.fileList).toEqual(['final-bid.zip']);
  });

  it('requires QC for a high-value tender: blocks until a QC approval exists', async () => {
    const { service, approvalRequests, tenders } = seed();
    tenders.rows[0]!.isAboveThreshold = true; // high-value → QC required
    pushApproval(approvalRequests, 'CUSTOMER');

    // Customer approved but QC required + not approved → blocked.
    await expect(
      service.submit(ORG_A, T_A, USER, { proofUrl: 'p' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Approve QC → now it submits.
    pushApproval(approvalRequests, 'QC', 'APPROVED', 2);
    const receipt = await service.submit(ORG_A, T_A, USER, { proofUrl: 'p' });
    expect(receipt.tenderId).toBe(T_A);
    expect(tenders.rows[0]!.status).toBe('SUBMITTED');
  });

  it('requires QC when pricing is high-risk (all lines unbacked)', async () => {
    const { service, approvalRequests, lineItems, priceObservations } = seed();
    pushApproval(approvalRequests, 'CUSTOMER');
    // One line backed only by an AI estimate → 100% unbacked → high-risk → QC.
    lineItems.rows.push({
      id: LI_A,
      tenderId: T_A,
      position: '01',
      description: 'LED',
      qty: '1',
      unit: 'pcs',
      bidEp: '100',
      bidGp: '100',
      longText: null,
      spec: null,
      brand: null,
      std: null,
      sourceDocId: null,
      parentId: null,
      __seq: 1,
    });
    priceObservations.rows.push({
      id: 'obs-1',
      lineItemId: LI_A,
      source: 'AI_ESTIMATE',
      price: '90',
      currency: 'EUR',
      note: null,
      createdBy: null,
      observedAt: new Date(),
      createdAt: new Date(),
      __seq: 1,
    });

    const r = await service.getReadiness(ORG_A, T_A);
    expect(r.highRisk).toBe(true);
    expect(r.qcRequired).toBe(true);
    await expect(
      service.submit(ORG_A, T_A, USER, { proofUrl: 'p' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s a submit against another org tender', async () => {
    const { service } = seed();
    await expect(
      service.submit(ORG_B, T_A, USER, { proofUrl: 'p' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

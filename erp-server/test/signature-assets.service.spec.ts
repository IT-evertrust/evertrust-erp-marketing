import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { schema } from '@evertrust/db';
import { WorkflowConfigService } from '../src/arsenal/workflow-config.service';
import {
  MAX_SIGNATURE_BYTES,
  SignatureAssetsService,
  type SignatureUpload,
} from '../src/arsenal/signature-assets.service';
import { SignatureImageController } from '../src/arsenal/signature-image.controller';
import type { AppConfigService } from '../src/config/app-config.service';
import { getDb, makeWorkflowConfig, rowsOf, seed } from './real-db';

// SignatureAssetsService stores a per-org signature image two ways — an uploaded file
// persisted as a signature_assets row (bytes base64 in TEXT) with org_config.
// signatureImageUrl pointed at the public serve URL, or a normalized link stored
// directly — and clears the pref. These tests drive the REAL service over the real db
// + a REAL WorkflowConfigService so the signatureImageUrl write genuinely lands on
// org_config and round-trips through getEffective(). The public serve route is
// exercised through SignatureImageController against a fake Response.

const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BASE_URL = 'https://evertrust-api.onrender.com';

function makeConfig(values: Record<string, string> = {}): AppConfigService {
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

// Build the service + a real WorkflowConfigService over the shared real db, plus the
// public serve controller (same SignatureAssetsService instance). Tables start empty
// (truncated per-test); specs read stored rows back via rowsOf(schema.signatureAssets).
function make() {
  const db = getDb();
  const wc: WorkflowConfigService = makeWorkflowConfig(db, makeConfig());
  const service = new SignatureAssetsService(db, wc);
  const controller = new SignatureImageController(service);
  return { service, wc, controller };
}

// A 1x1 transparent PNG (real bytes) so MIME + base64 round-trips are meaningful.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function upload(over: Partial<SignatureUpload> = {}): SignatureUpload {
  return {
    buffer: PNG_BYTES,
    mimetype: 'image/png',
    originalname: 'sig.png',
    size: PNG_BYTES.length,
    ...over,
  };
}

// Minimal fake express Response capturing the bytes + headers the serve route sets.
function fakeRes() {
  const headers: Record<string, unknown> = {};
  let body: Buffer | undefined;
  const res = {
    setHeader(name: string, value: unknown) {
      headers[name] = value;
      return res;
    },
    send(payload: Buffer) {
      body = payload;
      return res;
    },
  } as unknown as Response;
  return { res, headers, getBody: () => body };
}

describe('SignatureAssetsService.storeUpload', () => {
  it('persists a signature_assets row and sets org_config.signatureImageUrl to the absolute serve URL', async () => {
    const { service, wc } = make();
    const { signatureImageUrl } = await service.storeUpload(ORG, upload(), BASE_URL);

    // One asset row, bytes stored as base64 of the original buffer, org-scoped.
    const assetRows = await rowsOf(schema.signatureAssets);
    expect(assetRows).toHaveLength(1);
    const row = assetRows[0]!;
    expect(row.organizationId).toBe(ORG);
    expect(row.mimeType).toBe('image/png');
    expect(row.dataBase64).toBe(PNG_BYTES.toString('base64'));
    expect(row.byteSize).toBe(PNG_BYTES.length);
    expect(row.filename).toBe('sig.png');

    // The returned URL is the ABSOLUTE public serve URL for that row's id.
    expect(signatureImageUrl).toBe(
      `${BASE_URL}/public/signature-image/${row.id as string}`,
    );

    // ...and it round-trips through the per-org config read.
    const eff = await wc.getEffective(ORG);
    expect(eff.templates.signatureImageUrl).toBe(signatureImageUrl);
  });

  it('rejects an oversize image (> MAX_SIGNATURE_BYTES) without writing a row', async () => {
    const { service } = make();
    const big = Buffer.alloc(MAX_SIGNATURE_BYTES + 1, 1);
    await expect(
      service.storeUpload(ORG, upload({ buffer: big, size: big.length }), BASE_URL),
    ).rejects.toThrow(/too large/i);
    expect(await rowsOf(schema.signatureAssets)).toHaveLength(0);
  });

  it('rejects a disallowed MIME type without writing a row', async () => {
    const { service } = make();
    await expect(
      service.storeUpload(ORG, upload({ mimetype: 'application/pdf' }), BASE_URL),
    ).rejects.toThrow(/Unsupported image type/i);
    expect(await rowsOf(schema.signatureAssets)).toHaveLength(0);
  });

  it('rejects an empty upload', async () => {
    const { service } = make();
    await expect(
      service.storeUpload(ORG, upload({ buffer: Buffer.alloc(0) }), BASE_URL),
    ).rejects.toThrow(/empty/i);
  });
});

describe('SignatureAssetsService.setLink', () => {
  it('normalizes a Google Drive share link to its hotlinkable lh3 form and stores it (no asset row)', async () => {
    const { service, wc } = make();
    const driveLink =
      'https://drive.google.com/file/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv/view?usp=sharing';
    const { signatureImageUrl } = await service.setLink(ORG, driveLink);

    expect(signatureImageUrl).toBe(
      'https://lh3.googleusercontent.com/d/1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUv',
    );
    // No asset row for a link.
    expect(await rowsOf(schema.signatureAssets)).toHaveLength(0);
    // Stored on the per-org config.
    const eff = await wc.getEffective(ORG);
    expect(eff.templates.signatureImageUrl).toBe(signatureImageUrl);
  });

  it('leaves a non-Drive URL unchanged', async () => {
    const { service } = make();
    const { signatureImageUrl } = await service.setLink(
      ORG,
      'https://cdn.example.com/sig.png',
    );
    expect(signatureImageUrl).toBe('https://cdn.example.com/sig.png');
  });
});

describe('SignatureAssetsService.clear + WorkflowConfigService carry', () => {
  it('getEffective carries signatureImageUrl set via update(), and clear() nulls it', async () => {
    const { service, wc } = make();

    // update() persists the field through the templates group (PUT path).
    const url = 'https://lh3.googleusercontent.com/d/abc123';
    let eff = await wc.update({ templates: { signatureImageUrl: url } }, ORG);
    expect(eff.templates.signatureImageUrl).toBe(url);

    // clear() nulls the pref.
    await service.clear(ORG);
    eff = await wc.getEffective(ORG);
    expect(eff.templates.signatureImageUrl).toBeNull();
  });

  it('update() with signatureImageUrl: null clears a stored value', async () => {
    const { wc } = make();
    await wc.update(
      { templates: { signatureImageUrl: 'https://lh3.googleusercontent.com/d/x' } },
      ORG,
    );
    const eff = await wc.update({ templates: { signatureImageUrl: null } }, ORG);
    expect(eff.templates.signatureImageUrl).toBeNull();
  });
});

describe('SignatureImageController.serve (public)', () => {
  it('returns the decoded bytes with the stored Content-Type and a long cache header', async () => {
    const { service, controller } = make();
    const { signatureImageUrl } = await service.storeUpload(ORG, upload(), BASE_URL);
    const id = signatureImageUrl.split('/').pop()!;

    const { res, headers, getBody } = fakeRes();
    await controller.serve(id, res);

    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['Content-Length']).toBe(PNG_BYTES.length);
    expect(String(headers['Cache-Control'])).toMatch(/max-age=31536000/);
    expect(Buffer.isBuffer(getBody())).toBe(true);
    expect(getBody()!.equals(PNG_BYTES)).toBe(true);
  });

  it('404s for an unknown id', async () => {
    const { controller } = make();
    const { res } = fakeRes();
    await expect(
      controller.serve('ffffffff-ffff-ffff-ffff-ffffffffffff', res),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

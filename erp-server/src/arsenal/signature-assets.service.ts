import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@evertrust/db';
import { driveImageUrl } from '@evertrust/shared';
import { DB, type DbClient } from '../db/db.tokens';
import { WorkflowConfigService } from './workflow-config.service';

type SignatureAssetRow = typeof schema.signatureAssets.$inferSelect;

// The image MIME types an org may upload as a signature. Kept narrow on purpose —
// these are the formats that hotlink reliably from an email client. SVG is
// deliberately EXCLUDED: an uploaded asset is stored and served verbatim from the
// shared API origin (see SignatureImageController), and an SVG can carry inline
// script — serving untrusted SVG inline is a stored-XSS vector in a multi-tenant
// product. Raster formats only.
export const ALLOWED_SIGNATURE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

// Hard cap on the stored image. 512 KiB is plenty for an email signature image and
// keeps the base64 TEXT column (≈ +33% over the raw bytes) small. Enforced in the
// service (not only via multer limits) so the rule holds regardless of how the
// bytes arrive.
export const MAX_SIGNATURE_BYTES = 512 * 1024;

// The minimal slice of an uploaded file the service needs — matches the relevant
// fields of Express.Multer.File (memory storage gives us `buffer`). Declared
// locally so the service does not depend on the multer typings directly.
export interface SignatureUpload {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
  size?: number;
}

// PER-ORG signature image storage. Two ways to set an org's signature image:
//   - storeUpload(): persist an uploaded image as a signature_assets row (bytes kept
//     base64 in TEXT) and point org_config.signatureImageUrl at the API-served URL
//     GET /public/signature-image/:id (an ABSOLUTE url so it hotlinks from emails).
//   - setLink(): normalize a pasted Drive/lh3 share link (driveImageUrl) and store it
//     directly on org_config.signatureImageUrl — no asset row.
// clear() nulls the pref; getAsset() returns one stored row (for the public serve).
// The signatureImageUrl write always goes through WorkflowConfigService so it lands
// on the same org_config column the templates group resolves from.
@Injectable()
export class SignatureAssetsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly workflowConfig: WorkflowConfigService,
  ) {}

  // Validate + store an uploaded image for the org, then set its signatureImageUrl to
  // the ABSOLUTE public URL of the new asset. `baseUrl` is the absolute origin the
  // controller resolved from the request (protocol + host); it is joined with the
  // public serve path. Returns the resolved URL. Throws 400 on a bad MIME / oversize
  // image so the caller surfaces a clear error.
  async storeUpload(
    orgId: string,
    file: SignatureUpload,
    baseUrl: string,
  ): Promise<{ signatureImageUrl: string }> {
    const mimeType = (file.mimetype ?? '').toLowerCase().trim();
    if (!ALLOWED_SIGNATURE_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException(
        `Unsupported image type "${file.mimetype}". Allowed: ${[
          ...ALLOWED_SIGNATURE_MIME_TYPES,
        ].join(', ')}`,
      );
    }

    const bytes = file.buffer;
    if (!bytes || bytes.length === 0) {
      throw new BadRequestException('Empty image upload');
    }
    if (bytes.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException(
        `Image is too large (${bytes.length} bytes). Max is ${MAX_SIGNATURE_BYTES} bytes.`,
      );
    }

    const inserted = await this.db
      .insert(schema.signatureAssets)
      .values({
        organizationId: orgId,
        mimeType,
        dataBase64: bytes.toString('base64'),
        filename: file.originalname ?? null,
        byteSize: bytes.length,
      })
      .returning();
    const asset = inserted[0]!;

    // Absolute so the URL is hotlinkable straight from an email (no relative base).
    const signatureImageUrl = `${baseUrl.replace(/\/+$/, '')}/public/signature-image/${asset.id}`;
    await this.workflowConfig.setSignatureImageUrl(orgId, signatureImageUrl);
    return { signatureImageUrl };
  }

  // Set the org's signature image to a pasted link, normalized via driveImageUrl()
  // (a Drive share link → its hotlinkable lh3 form; any other URL is kept as-is).
  // No asset row is created — the bytes live wherever the URL points. Returns the
  // stored (normalized) URL.
  async setLink(orgId: string, url: string): Promise<{ signatureImageUrl: string }> {
    const normalized = driveImageUrl(url);
    if (normalized.length === 0) {
      throw new BadRequestException('Signature image URL is empty');
    }
    await this.workflowConfig.setSignatureImageUrl(orgId, normalized);
    return { signatureImageUrl: normalized };
  }

  // Clear the org's signature image pref (null on org_config.signatureImageUrl). Does
  // NOT delete any signature_assets rows — a cleared pref just stops pointing at one,
  // and the public serve route still works for a known id (idempotent, no 404 churn).
  async clear(orgId: string): Promise<void> {
    await this.workflowConfig.setSignatureImageUrl(orgId, null);
  }

  // The signature_assets row for an id, or null when unknown. Used by the public
  // serve route to stream the decoded bytes. NOT org-scoped on purpose: the URL is a
  // public, unguessable (uuid) hotlink embedded in sent emails — anyone with the link
  // may load the image (exactly like a Drive/lh3 hotlink), so there is no caller org
  // to confine it to.
  async getAsset(id: string): Promise<SignatureAssetRow | null> {
    const rows = await this.db
      .select()
      .from(schema.signatureAssets)
      .where(eq(schema.signatureAssets.id, id))
      .limit(1);
    return rows[0] ?? null;
  }
}

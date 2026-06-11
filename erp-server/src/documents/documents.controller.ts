import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { UploadDocumentDto, type DocumentDto } from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { setAuditContext } from '../common/audit-context';
import { AppConfigService } from '../config/app-config.service';
import { DocumentsService } from './documents.service';

// TYPE 1 document upload/list (tender-scoped) + a tenant-checked binary download.
// Uses one controller with explicit paths so the multipart/multer wiring stays
// isolated to the documents module. Tenancy comes from @OrgId(), never the body.
@Controller()
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly config: AppConfigService,
  ) {}

  // Upload a document to a tender. multipart: `file` + text fields type/kind.
  // 404 if the tender is not in the caller's org; inserts the row and audits.
  @RequirePermissions('tenders:write')
  @Post('tenders/:id/documents')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @OrgId() orgId: string,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) tenderId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<DocumentDto> {
    if (!file) throw new BadRequestException('file is required');

    // Multipart text fields (type/kind) arrive as strings in req.body; validate
    // them against the shared contract. Invalid `type` -> 400. type defaults TYPE1.
    const parsed = UploadDocumentDto.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new BadRequestException('Invalid document fields');
    }
    const body = parsed.data;

    const doc = await this.documents.create(orgId, tenderId, {
      type: body.type,
      kind: body.kind,
      storageUrl: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: user.id,
    });

    setAuditContext(req, {
      entity: 'documents',
      entityId: doc.id,
      action: 'UPLOAD',
      after: doc,
    });
    return doc;
  }

  @RequirePermissions('tenders:read')
  @Get('tenders/:id/documents')
  list(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) tenderId: string,
  ): Promise<DocumentDto[]> {
    return this.documents.listForTender(orgId, tenderId);
  }

  // Stream a document's bytes. The service enforces that the doc's tender is in
  // the caller's org (404 otherwise). Content-Disposition uses the original name.
  @RequirePermissions('tenders:read')
  @Get('documents/:id/download')
  async download(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) docId: string,
    @Res() res: Response,
  ): Promise<void> {
    const doc = await this.documents.getForDownload(orgId, docId);
    const path = join(this.config.get('UPLOAD_DIR'), doc.storageUrl);

    // The DB row exists but the file is gone -> 404 (not a 500 stack trace).
    try {
      await stat(path);
    } catch {
      throw new NotFoundException('File not found on disk');
    }

    res.setHeader(
      'Content-Type',
      doc.mimeType ?? 'application/octet-stream',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(doc.originalName)}"`,
    );
    createReadStream(path).pipe(res);
  }
}

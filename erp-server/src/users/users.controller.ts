import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import type { Request } from 'express';
import { driveImageUrl } from '@evertrust/shared';
import type { MeDto, UserListItemDto } from '@evertrust/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { OrgId } from '../common/tenant';
import { setAuditContext } from '../common/audit-context';
import {
  MAX_SIGNATURE_BYTES,
  SignatureAssetsService,
} from '../arsenal/signature-assets.service';
import { UsersService } from './users.service';
import {
  UpdateMyNameBodyDto,
  UpdateMySenderIdentityBodyDto,
} from './users.dto';

// The JSON body shape for the link-based signature-image path: { url: <a valid URL> }.
// Validated manually (not the global ZodValidationPipe) because the route also accepts
// a multipart file, so it can't declare a single createZodDto @Body() type. Mirrors the
// org route in arsenal/workflow-config.controller.ts.
const SignatureLinkBody = z.object({ url: z.string().url() });

// Build the ABSOLUTE origin (protocol + host) for the current request, used as the base
// of the public signature-image URL so it hotlinks straight from an email. Copied from
// workflow-config.controller.ts: the X-Forwarded-Proto header wins behind the
// TLS-terminating proxy (where req.protocol reports http), else req.protocol; the host
// comes from the Host header.
function requestBaseUrl(req: Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0]?.trim() : '') ||
    req.protocol;
  const host = req.get('host');
  if (!host) throw new BadRequestException('Cannot resolve request host');
  return `${proto}://${host}`;
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly signatureAssets: SignatureAssetsService,
  ) {}

  // Org directory for pickers (e.g. tender assignee). Authenticated-only — NO
  // @RequirePermissions — so any logged-in member can resolve their colleagues;
  // strictly tenant-scoped to the caller's organization.
  @Get()
  list(@OrgId() orgId: string): Promise<UserListItemDto[]> {
    return this.users.listForOrg(orgId);
  }

  // The demo AUDITED mutation. Updates the caller's name, then records the
  // before/after on the request so the global AuditInterceptor writes an
  // audit_log row (entity 'users', entityId = the user id, action UPDATE).
  @Patch('me')
  async updateMyName(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateMyNameBodyDto,
    @Req() req: Request,
  ): Promise<MeDto> {
    const { before, after } = await this.users.updateName(user.id, body.name);

    setAuditContext(req, {
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      before,
      after: { name: after.name },
    });

    return after;
  }

  // Update the CURRENT user's OWN sender identity (display name + signature text).
  // JWT-auth only (no @RequirePermissions) — any logged-in user edits their OWN
  // identity. Always targets user.id, so a user can never touch another's row.
  // Audited. Returns the freshly-resolved MeDto.
  @Patch('me/sender-identity')
  async updateMySenderIdentity(
    @CurrentUser() user: AuthUser,
    @Body() body: UpdateMySenderIdentityBodyDto,
    @Req() req: Request,
  ): Promise<MeDto> {
    const after = await this.users.updateSenderIdentity(user.id, body);

    setAuditContext(req, {
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      after: {
        senderName: after.senderName,
        senderEmail: after.senderEmail,
        signature: after.signature,
      },
    });

    return after;
  }

  // Set the CURRENT user's signature image. Accepts EITHER a multipart `file` (stored
  // as a signature_assets row; the URL points at the absolute public serve path) OR a
  // JSON body { url } (normalized via driveImageUrl and stored directly, no asset row).
  // The asset is org-tagged (orgId) but the chosen URL is recorded on the USER's own
  // row — never another user's. JWT-auth only. Audited. Returns { signatureImageUrl }
  // (matching the client SignatureImageResult shape).
  @Post('me/signature-image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIGNATURE_BYTES },
    }),
  )
  async setMySignatureImage(
    @CurrentUser() user: AuthUser,
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<{ signatureImageUrl: string | null }> {
    let url: string;
    if (file) {
      url = await this.signatureAssets.storeAssetBytes(
        orgId,
        {
          buffer: file.buffer,
          mimetype: file.mimetype,
          originalname: file.originalname,
          size: file.size,
        },
        requestBaseUrl(req),
      );
    } else {
      // No file → expect a JSON { url }. Validate manually (the route also serves
      // multipart, so it can't use a single createZodDto @Body() type).
      const parsed = SignatureLinkBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new BadRequestException(
          'Provide a multipart `file` or a JSON body { url } with a valid URL',
        );
      }
      url = driveImageUrl(parsed.data.url);
    }

    const me = await this.users.setSignatureImageUrl(user.id, url);
    setAuditContext(req, {
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      after: { signatureImageUrl: me.signatureImageUrl },
    });
    return { signatureImageUrl: me.signatureImageUrl ?? null };
  }

  // Clear the CURRENT user's signature image (null on users.signature_image_url).
  // Does not delete stored asset rows. JWT-auth only. Audited.
  @Delete('me/signature-image')
  async clearMySignatureImage(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<{ signatureImageUrl: null }> {
    await this.users.setSignatureImageUrl(user.id, null);
    setAuditContext(req, {
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      after: { signatureImageUrl: null },
    });
    return { signatureImageUrl: null };
  }
}

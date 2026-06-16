import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SignatureAssetsService } from './signature-assets.service';

// PUBLIC signature-image serve. Hotlinked straight from sent emails, so it carries
// NO auth (@Public — like the n8n runs/callback route): an email client loading the
// <img> has no session. The id is an unguessable uuid (the only thing exposed). The
// stored base64 bytes are decoded and streamed with the asset's own Content-Type and
// a long immutable Cache-Control (the bytes never change for a given id); an unknown
// id is a 404 (not a 500). Lives on its own controller so /public/* stays separate
// from the admin-guarded /arsenal/config/* surface.
@Controller()
export class SignatureImageController {
  constructor(private readonly signatureAssets: SignatureAssetsService) {}

  @Public()
  @Get('public/signature-image/:id')
  async serve(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.signatureAssets.getAsset(id);
    if (!asset) throw new NotFoundException('Signature image not found');

    const bytes = Buffer.from(asset.dataBase64, 'base64');
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', bytes.length);
    // Defense-in-depth for a public, unauthenticated byte-serve on the shared API
    // origin: never let the browser sniff a different type, and neutralize any active
    // content if a crafted file ever slips past the raster-only upload allowlist.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    // Bytes are immutable for an id → cache hard (1 year) so email clients / proxies
    // do not re-hit the API on every open.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(bytes);
  }
}

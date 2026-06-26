import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import {
  KnowledgeService,
  MAX_KNOWLEDGE_BYTES,
  type KnowledgeDoc,
} from './knowledge.service';

// Engage knowledge base ("company resources"). The operator uploads documents the reply
// drafter grounds UNSURE replies on (full-text searched at draft time). JWT-auth +
// org-scoped like the rest of Engage; upload/delete are campaigns:write, list is
// campaigns:read. The file uses in-memory multer storage so the service extracts text
// from the bytes directly (no disk write).
@Controller('engage/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @RequirePermissions('campaigns:read')
  @Get()
  list(@OrgId() orgId: string): Promise<KnowledgeDoc[]> {
    return this.knowledge.list(orgId);
  }

  @RequirePermissions('campaigns:write')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_KNOWLEDGE_BYTES },
    }),
  )
  upload(
    @OrgId() orgId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<KnowledgeDoc> {
    if (!file) {
      throw new BadRequestException('No file uploaded (field name must be "file").');
    }
    return this.knowledge.upload(orgId, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
      size: file.size,
    });
  }

  @RequirePermissions('campaigns:write')
  @Delete(':id')
  remove(@OrgId() orgId: string, @Param('id') id: string): Promise<{ ok: true }> {
    return this.knowledge.remove(orgId, id);
  }
}

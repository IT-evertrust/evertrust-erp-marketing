import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

// ~25 MB ceiling per uploaded document.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// MIME types we accept for TYPE 1 tender documents: PDFs, common images, Word /
// Office Open XML, plain XML (GAEB exchange), and the generic octet-stream that
// some browsers send for unrecognized extensions.
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/xml',
  'text/xml',
  'application/octet-stream',
]);

// Multer options for the document FileInterceptor: disk storage under UPLOAD_DIR
// with a collision-proof random filename (original name is preserved separately
// in the documents row), a size cap, and a MIME allowlist.
export function documentMulterOptions(uploadDir: string): MulterOptions {
  return {
    storage: diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        cb(null, `${randomUUID()}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME.has(file.mimetype)) {
        cb(null, true);
        return;
      }
      cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
    },
  };
}

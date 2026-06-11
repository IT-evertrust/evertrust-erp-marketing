import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfigService } from '../config/app-config.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { documentMulterOptions } from './upload.config';

@Module({
  imports: [
    // Configure multer disk storage from UPLOAD_DIR at runtime, so FileInterceptor
    // can stay option-free at the call site (filename = randomUUID + ext, MIME
    // allowlist, ~25MB cap — see upload.config.ts). AppConfigService comes from the
    // @Global() AppConfigModule, so no explicit import is needed.
    MulterModule.registerAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        documentMulterOptions(config.get('UPLOAD_DIR')),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}

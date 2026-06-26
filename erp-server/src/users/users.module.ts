import { Module } from '@nestjs/common';
import { ArsenalModule } from '../arsenal/arsenal.module';
import { UsersController } from './users.controller';
import { AdminController } from './admin.controller';
import { UsersService } from './users.service';

// Imports ArsenalModule for SignatureAssetsService — the per-user signature-image
// route reuses the same asset-bytes storage as the org signature image.
@Module({
  imports: [ArsenalModule],
  controllers: [UsersController, AdminController],
  providers: [UsersService],
})
export class UsersModule {}

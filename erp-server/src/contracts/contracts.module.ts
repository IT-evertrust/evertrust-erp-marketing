import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

// The Contract Generator (Contract Assist) feature. The DB client is global
// (DbModule) so the service injects it directly under the DB token — no imports
// needed.
@Module({
  controllers: [ContractsController],
  providers: [ContractsService],
})
export class ContractsModule {}

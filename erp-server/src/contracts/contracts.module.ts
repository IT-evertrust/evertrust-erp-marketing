import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

// ContractMaker output (machine routes). DB is global; the service consumes it.
// ArsenalTokenGuard gates every (@Public()) route.
@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ArsenalTokenGuard],
})
export class ContractsModule {}

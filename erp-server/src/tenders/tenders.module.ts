import { Module } from '@nestjs/common';
import { TendersController } from './tenders.controller';
import { TendersService } from './tenders.service';
import { AssignmentsService } from './assignments.service';

@Module({
  controllers: [TendersController],
  providers: [TendersService, AssignmentsService],
})
export class TendersModule {}

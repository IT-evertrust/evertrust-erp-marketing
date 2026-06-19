import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import { createAimSchema, type CreateAimDto } from './dto/create-aim.dto';
import { ReachService } from './reach.service';

@Controller('growth/reach')
export class ReachController {
  constructor(private readonly reachService: ReachService) {}

  @Get('aims')
  getAims() {
    return this.reachService.getAims();
  }

  @Get('aims/:aimId')
  getAim(@Param('aimId') aimId: string) {
    return this.reachService.getAim(aimId);
  }

  @Post('aims')
  createAim(@Body() body: CreateAimDto) {
    const dto = createAimSchema.parse(body);
    return this.reachService.createAim(dto);
  }

  @Patch('aims/:aimId/start')
  startAim(@Param('aimId') aimId: string) {
    return this.reachService.startAim(aimId);
  }

  @Get('aims/:aimId/leads')
  getAimLeads(@Param('aimId') aimId: string) {
    return this.reachService.getAimLeads(aimId);
  }
}
import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { PersonasController } from './personas.controller';
import { PersonasService } from './personas.service';

// On-demand analysis runs on n8n (EVERTRUST - SALES AGENT, OpenAI GPT-5-mini),
// so no AiModule/Claude dependency here.
@Module({
  controllers: [MeetingsController, PersonasController],
  providers: [MeetingsService, PersonasService],
})
export class MeetingsModule {}

import { Module } from '@nestjs/common';
import { ClaudeService } from './claude.service';

// AI integration layer (Phase 5b onward). The single boundary to Anthropic. Claude
// is the only AI provider per the Combine ("Claude only"). DB + AppConfigService are
// global; this module just provides + exports the thin ClaudeService so any feature
// module (pricing today; Scribe/Sieve later) can inject it.
@Module({
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class AiModule {}

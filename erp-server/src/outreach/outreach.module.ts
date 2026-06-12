import { Module } from '@nestjs/common';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { OutreachController } from './outreach.controller';
import { OutreachMessagesService } from './outreach-messages.service';
import { ReplyClassificationsService } from './reply-classifications.service';
import { SuppressionsService } from './suppressions.service';

// Outreach reply plane (machine routes): conversation ledger + reply-classification
// verdict log + suppression list. DB is global; the services consume it.
// ArsenalTokenGuard gates every (@Public()) route.
@Module({
  controllers: [OutreachController],
  providers: [
    OutreachMessagesService,
    ReplyClassificationsService,
    SuppressionsService,
    ArsenalTokenGuard,
  ],
})
export class OutreachModule {}

import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Query,
} from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { GmailWatchService } from './gmail-watch.service';

// The Cloud Pub/Sub push envelope: the change payload is base64 in message.data.
type PubSubPushBody = {
  message?: { data?: string; messageId?: string };
  subscription?: string;
};

// ===========================================================================
// Engage · gmail.watch push receiver. Google publishes INBOX changes to the Pub/Sub
// topic; the topic's PUSH subscription POSTs them here. @Public (Pub/Sub sends no JWT)
// — optionally gated by a ?token= shared secret (set GMAIL_PUSH_TOKEN and append it to
// the subscription's push endpoint URL). Acks fast (204) and runs the slow scan in the
// background so Pub/Sub doesn't retry on timeout.
// ===========================================================================
@Controller('engage/gmail')
export class GmailPushController {
  private readonly logger = new Logger(GmailPushController.name);

  constructor(private readonly watch: GmailWatchService) {}

  @Public()
  @Post('push')
  @HttpCode(204)
  push(@Body() body: PubSubPushBody, @Query('token') token?: string): void {
    const expected = process.env.GMAIL_PUSH_TOKEN?.trim();
    if (expected && token !== expected) {
      throw new ForbiddenException('bad push token');
    }

    const data = body?.message?.data;
    if (!data) return;

    let payload: { emailAddress?: string; historyId?: string };
    try {
      payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as {
        emailAddress?: string;
        historyId?: string;
      };
    } catch {
      this.logger.warn('gmail push: undecodable message.data — ignored.');
      return;
    }

    // Don't block the ack on the (slow) scan.
    void this.watch.handlePush(payload).catch((err) =>
      this.logger.warn(
        `gmail push handling failed: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}

import { Controller, Get, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import {
  GmailListQueryDto,
  GmailMessageDetailDto,
  GmailMessagesListDto,
  GmailProfileDto,
  GoogleGmailService,
} from './google-gmail.service';

// Gmail API read endpoints for the CALLING org's connected default mailbox.
// JWT-auth + tenant-scoped (@OrgId). These routes only read Gmail; they never send,
// mutate, delete, or mark messages as read.
@Controller('google/gmail')
export class GoogleGmailController {
  constructor(private readonly gmail: GoogleGmailService) {}

  @RequirePermissions('campaigns:read')
  @Get('profile')
  profile(@OrgId() orgId: string): Promise<GmailProfileDto> {
    return this.gmail.profile(orgId);
  }

  // Query examples:
  //   /google/gmail/messages?q=from:alice@example.com newer_than:30d
  //   /google/gmail/messages?labelIds=INBOX,UNREAD&maxResults=10
  //   /google/gmail/messages?includeSpamTrash=true
  @RequirePermissions('campaigns:read')
  @Get('messages')
  listMessages(
    @OrgId() orgId: string,
    @Query() query: GmailListQueryDto,
  ): Promise<GmailMessagesListDto> {
    return this.gmail.listMessages(orgId, query);
  }

  @RequirePermissions('campaigns:read')
  @Get('messages/:messageId')
  getMessage(
    @OrgId() orgId: string,
    @Param('messageId') messageId: string,
  ): Promise<GmailMessageDetailDto> {
    return this.gmail.getMessage(orgId, messageId);
  }
}

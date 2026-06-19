import { Injectable } from '@nestjs/common';

import type { SaveReplyDraftDto } from './dto/save-reply-draft.dto';
import type { SendReplyDto } from './dto/send-reply.dto';
import type { EngageReply } from './engage.model';

@Injectable()
export class EngageRepository {
  private replies: EngageReply[] = [
    {
      id: 'reply-1',
      campaignId: 'nrw',
      company: 'HV Rheinland GmbH',
      contact: 'Mr. Schmitz · Portfolio Manager',
      recipientEmail: 'schmitz@hv-rheinland.example',
      category: 'INTERESTED',
      inboundSubject: 'Re: 600W balcony solar kits',
      inboundBody:
        'Interesting — could you send a quote for 120 units? Storage optional, please include delivery times.',
      draftSubject: 'Re: 600W balcony solar kits - next steps',
      draftBody:
        'Dear Mr. Schmitz,\n\nThank you for your interest. For 120 units, I will prepare a tiered quote including delivery times.\n\nBest regards,\nEvertrust Growth Engine',
      status: 'NEEDS_REPLY',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  findRepliesByCampaignId(campaignId: string): EngageReply[] {
    return this.replies.filter((reply) => reply.campaignId === campaignId);
  }

  findReplyById(replyId: string): EngageReply | undefined {
    return this.replies.find((reply) => reply.id === replyId);
  }

  saveDraft(replyId: string, dto: SaveReplyDraftDto): EngageReply | undefined {
    const reply = this.findReplyById(replyId);

    if (!reply) return undefined;

    const now = new Date().toISOString();

    reply.draftSubject = dto.subject;
    reply.draftBody = dto.body;
    reply.status = 'DRAFT_SAVED';
    reply.savedAt = now;
    reply.updatedAt = now;

    return reply;
  }

  markSent(replyId: string, dto: SendReplyDto): EngageReply | undefined {
    const reply = this.findReplyById(replyId);

    if (!reply) return undefined;

    const now = new Date().toISOString();

    reply.draftSubject = dto.subject;
    reply.draftBody = dto.body;
    reply.status = 'SENT';
    reply.sentAt = now;
    reply.updatedAt = now;

    return reply;
  }
}
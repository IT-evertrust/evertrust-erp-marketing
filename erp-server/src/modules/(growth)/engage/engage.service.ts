import { Injectable, NotFoundException } from '@nestjs/common';

import type { SaveReplyDraftDto } from './dto/save-reply-draft.dto';
import type { SendReplyDto } from './dto/send-reply.dto';
import { EngageRepository } from './engage.repository';

@Injectable()
export class EngageService {
  constructor(private readonly engageRepository: EngageRepository) {}

  getReplies(campaignId: string) {
    return this.engageRepository.findRepliesByCampaignId(campaignId);
  }

  saveDraft(replyId: string, dto: SaveReplyDraftDto) {
    const reply = this.engageRepository.saveDraft(replyId, dto);

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    return reply;
  }

  async sendReply(replyId: string, dto: SendReplyDto) {
    const reply = this.engageRepository.findReplyById(replyId);

    if (!reply) {
      throw new NotFoundException('Reply not found');
    }

    // Later:
    // 1. Create/send Gmail message through Google service
    // 2. Save Gmail message ID
    // 3. Mark reply as sent only after Gmail succeeds

    return this.engageRepository.markSent(replyId, dto);
  }
}
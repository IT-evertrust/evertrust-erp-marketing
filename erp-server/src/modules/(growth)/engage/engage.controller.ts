import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import {
  saveReplyDraftSchema,
  type SaveReplyDraftDto,
} from './dto/save-reply-draft.dto';
import { sendReplySchema, type SendReplyDto } from './dto/send-reply.dto';
import { EngageService } from './engage.service';

@Controller('growth/engage')
export class EngageController {
  constructor(private readonly engageService: EngageService) {}

  @Get('campaigns/:campaignId/replies')
  getReplies(@Param('campaignId') campaignId: string) {
    return this.engageService.getReplies(campaignId);
  }

  @Patch('replies/:replyId/draft')
  saveDraft(@Param('replyId') replyId: string, @Body() body: SaveReplyDraftDto) {
    const dto = saveReplyDraftSchema.parse(body);
    return this.engageService.saveDraft(replyId, dto);
  }

  @Post('replies/:replyId/send')
  sendReply(@Param('replyId') replyId: string, @Body() body: SendReplyDto) {
    const dto = sendReplySchema.parse(body);
    return this.engageService.sendReply(replyId, dto);
  }
}
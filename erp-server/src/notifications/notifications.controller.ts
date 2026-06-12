import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { schema } from '@evertrust/db';
import type { NotificationDto } from '@evertrust/shared';
import { Public } from '../auth/decorators/public.decorator';
import { ArsenalTokenGuard } from '../common/guards/arsenal-token.guard';
import { OrgId } from '../common/tenant';
import { NotificationsService } from './notifications.service';
import { CreateNotificationBodyDto } from './notifications.dto';

type NotificationRow = typeof schema.notifications.$inferSelect;

function toDto(r: NotificationRow): NotificationDto {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// In-app notification feed. GET/PATCH are JWT (the bell UI, org-scoped from the
// principal). POST is a MACHINE route (n8n writebacks): @Public() + ArsenalTokenGuard
// with the org resolved from campaignId. The machine write is audited (actorType N8N).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // The bell feed (JWT). unread=true limits to unread; limit caps the page.
  @Get()
  async list(
    @OrgId() orgId: string,
    @Query('unread') unread?: string,
    @Query('limit') limitParam?: string,
  ): Promise<NotificationDto[]> {
    const limit = Number.parseInt(limitParam ?? '', 10);
    const rows = await this.notifications.list(orgId, {
      unread: unread === 'true',
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return rows.map(toDto);
  }

  // Mark one notification read (JWT, idempotent). 404 if it isn't this org's.
  @Patch(':id/read')
  async markRead(
    @OrgId() orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationDto> {
    const row = await this.notifications.markRead(orgId, id);
    return toDto(row);
  }

  // Create a notification (MACHINE — n8n). org resolved from campaignId.
  @Public()
  @UseGuards(ArsenalTokenGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateNotificationBodyDto,
  ): Promise<NotificationDto> {
    const row = await this.notifications.create(body);
    return toDto(row);
  }
}

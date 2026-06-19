import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
  CalendarMutationResultDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from '@evertrust/shared';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { OrgId } from '../common/tenant';
import { GoogleCalendarReadService } from './google-calendar-read.service';
import { CreateCalendarEventBodyDto, UpdateCalendarEventBodyDto } from './google.dto';

// Activate · live Google Calendar (read). Real upcoming meetings + proposed free
// slots from the CALLING org's connected default calendar mailbox. JWT-auth +
// tenant-scoped (@OrgId), gated campaigns:read. Both endpoints degrade to a
// `configured: false` shell rather than erroring, so the Activate page never 500s.
@Controller('meetings/calendar')
export class GoogleCalendarReadController {
  constructor(private readonly calendar: GoogleCalendarReadService) {}

  @RequirePermissions('campaigns:read')
  @Get('upcoming')
  upcoming(
    @OrgId() orgId: string,
    @Query('timeMin') timeMin?: string,
    @Query('timeMax') timeMax?: string,
    @Query('timeZone') timeZone?: string,
  ) {
    return this.calendar.upcoming(orgId, {
      timeMin,
      timeMax,
      timeZone,
    });
  }

  @RequirePermissions('campaigns:read')
  @Get('free-slots')
  freeSlots(
    @OrgId() orgId: string,
    @Query('timeMin') timeMin?: string,
    @Query('timeMax') timeMax?: string,
    @Query('timeZone') timeZone?: string,
    @Query('durationMinutes') durationMinutes?: string,
  ) {
    return this.calendar.freeSlots(orgId, {
      timeMin,
      timeMax,
      timeZone,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
    });
  }

  // Mutations write to the org's real Google Calendar and email attendees
  // (sendUpdates:all), so they require campaigns:write — EMPLOYEE (read-only) cannot
  // create/modify/cancel meetings, while the reads above stay campaigns:read.
  @RequirePermissions('campaigns:write')
  @Post('events')
  createEvent(
    @OrgId() orgId: string,
    @Body() body: CreateCalendarEventBodyDto,
  ): Promise<CalendarMutationResultDto> {
    return this.calendar.createEvent(orgId, body as CreateCalendarEventDto);
  }

  @RequirePermissions('campaigns:write')
  @Patch('events/:eventId')
  updateEvent(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() body: UpdateCalendarEventBodyDto,
  ): Promise<CalendarMutationResultDto> {
    return this.calendar.updateEvent(orgId, eventId, body as UpdateCalendarEventDto);
  }

  @RequirePermissions('campaigns:write')
  @Delete('events/:eventId')
  deleteEvent(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    return this.calendar.deleteEvent(orgId, eventId);
  }
}

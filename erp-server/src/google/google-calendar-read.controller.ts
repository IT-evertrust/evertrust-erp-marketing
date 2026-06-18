import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
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
  upcoming(@OrgId() orgId: string): Promise<CalendarUpcomingDto> {
    return this.calendar.upcoming(orgId);
  }

  @RequirePermissions('campaigns:read')
  @Get('free-slots')
  freeSlots(@OrgId() orgId: string): Promise<CalendarFreeSlotsDto> {
    return this.calendar.freeSlots(orgId);
  }
  @Post('events')
  createEvent(
    @OrgId() orgId: string,
    @Body() body: CreateCalendarEventBodyDto,
  ): Promise<CalendarMutationResultDto> {
    return this.calendar.createEvent(orgId, body as CreateCalendarEventDto);
  }

  @Patch('events/:eventId')
  updateEvent(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
    @Body() body: UpdateCalendarEventBodyDto,
  ): Promise<CalendarMutationResultDto> {
    return this.calendar.updateEvent(orgId, eventId, body as UpdateCalendarEventDto);
  }

  @Delete('events/:eventId')
  deleteEvent(
    @OrgId() orgId: string,
    @Param('eventId') eventId: string,
  ): Promise<{ ok: boolean; reason: string | null }> {
    return this.calendar.deleteEvent(orgId, eventId);
  }
}

import type {
  CalendarEventDto,
  CalendarFreeSlotsDto,
  CalendarUpcomingDto,
} from '@evertrust/shared';

export type CalendarView = 'day' | 'week' | 'month';

export type UpcomingQuery = {
  data?: CalendarUpcomingDto;
  isLoading: boolean;
  isError: boolean;
};

export type FreeSlotsQuery = {
  data?: CalendarFreeSlotsDto;
  isLoading: boolean;
  isError: boolean;
};

export type CalendarGridEvent = CalendarEventDto & {
  startDate: Date;
  endDate: Date;
};

export type CalendarGridSlot = {
  start: Date;
  end: Date;
};

export type CalendarEventLayout = {
  column: number;
  columns: number;
};

export type LaidOutCalendarEvent = CalendarGridEvent & {
  layout: CalendarEventLayout;
};

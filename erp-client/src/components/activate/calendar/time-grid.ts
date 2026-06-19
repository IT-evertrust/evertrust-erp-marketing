// Bootstrap/product-default zone used only until the org's resolved timezone arrives
// from the calendar API. The org's actual primary/secondary zones (org_config) drive
// all rendering — see primaryTz / secondaryTz threaded from the calendar payload.
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

export const HOUR_HEIGHT = 72;
export const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateKey(dateKey: string): {
  year: number;
  month: number;
  day: number;
} {
  const parts = dateKey.split('-');

  const yearText = parts[0];
  const monthText = parts[1];
  const dayText = parts[2];

  if (!yearText || !monthText || !dayText) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  return {
    year,
    month,
    day,
  };
}

export function dateKeyToUtcDate(dateKey: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));

  return toDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function getZonedParts(
  date: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';

  const rawHour = Number(get('hour'));

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
  };
}

export function zonedTimeToUtcDate(dateKey: string, hour: number, minute: number, timeZone: string): Date {
  const { year, month, day } = parseDateKey(dateKey);

  const wantedLocalMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let utcMs = wantedLocalMs;

  for (let i = 0; i < 3; i += 1) {
    const actualParts = getZonedParts(new Date(utcMs), timeZone);

    const actualLocalMs = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      0,
      0,
    );

    utcMs += wantedLocalMs - actualLocalMs;
  }

  return new Date(utcMs);
}

export function startOfWorkWeekKey(date: Date, timeZone: string): string {
  const parts = getZonedParts(date, timeZone);
  const currentKey = toDateKey(parts.year, parts.month, parts.day);
  const currentDate = dateKeyToUtcDate(currentKey);
  const day = currentDate.getUTCDay();

  const diffToMonday = day === 0 ? -6 : 1 - day;

  return addDaysToDateKey(currentKey, diffToMonday);
}

export function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

export function overlapsDateKey(start: Date, end: Date, dateKey: string, timeZone: string): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  return end > dayStart && start < dayEnd;
}

export function overlapsDateKeyRange(
  start: Date,
  end: Date,
  startKey: string,
  endKeyExclusive: string,
  timeZone: string,
): boolean {
  if (!isValidDate(start) || !isValidDate(end) || end <= start) {
    return false;
  }

  const rangeStart = zonedTimeToUtcDate(startKey, 0, 0, timeZone);
  const rangeEnd = zonedTimeToUtcDate(endKeyExclusive, 0, 0, timeZone);

  return end > rangeStart && start < rangeEnd;
}

export function getVisualRangeForDateKey(
  start: Date,
  end: Date,
  dateKey: string,
  timeZone: string,
): {
  startMinute: number;
  endMinute: number;
} {
  const dayStart = zonedTimeToUtcDate(dateKey, 0, 0, timeZone);
  const dayEnd = zonedTimeToUtcDate(addDaysToDateKey(dateKey, 1), 0, 0, timeZone);

  const visualStart = start < dayStart ? dayStart : start;
  const visualEnd = end > dayEnd ? dayEnd : end;

  if (visualEnd <= visualStart) {
    return {
      startMinute: 0,
      endMinute: 30,
    };
  }

  const startMinute =
    visualStart <= dayStart ? 0 : zonedMinutesSinceMidnight(visualStart, timeZone);

  const rawEndMinute =
    visualEnd >= dayEnd ? 24 * 60 : zonedMinutesSinceMidnight(visualEnd, timeZone);

  return {
    startMinute,
    endMinute: Math.min(24 * 60, Math.max(startMinute + 20, rawEndMinute)),
  };
}

export function zonedMinutesSinceMidnight(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);

  return parts.hour * 60 + parts.minute;
}

export function minuteToTop(minute: number): number {
  const rawTop = (minute / 60) * HOUR_HEIGHT;
  const maxTop = HOURS.length * HOUR_HEIGHT - 30;

  return Math.max(0, Math.min(rawTop, maxTop));
}

export function minuteRangeToHeight(startMinute: number, endMinute: number): number {
  const minutes = Math.max(20, endMinute - startMinute);

  return Math.max(32, (minutes / 60) * HOUR_HEIGHT);
}

export function getIsoWeekNumber(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = date.getUTCDay() || 7;

  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));

  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function formatClockInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// A short, human-readable label for an IANA zone (e.g. 'Europe/Berlin' → "GMT+2",
// 'Asia/Bangkok' → "GMT+7"), derived at the given instant so DST is reflected. Used
// for the time-scale gutters and event copy — never a hardcoded "CET/CEST"/"GMT+7".
export function zoneShortLabel(timeZone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');

  return part?.value ?? timeZone;
}

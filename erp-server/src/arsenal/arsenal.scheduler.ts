import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { isValidTimeZone } from '@evertrust/shared';
import { ArsenalService } from './arsenal.service';

// Wall-clock parts of `epochMs` as seen in `timeZone` (via Intl — the only
// dependency-free tz source). Some engines render midnight as hour 24; normalize it.
function zonedParts(
  epochMs: number,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  let year = 0;
  let month = 1;
  let day = 1;
  let hour = 0;
  let minute = 0;
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    const v = Number(part.value);
    switch (part.type) {
      case 'year':
        year = v;
        break;
      case 'month':
        month = v;
        break;
      case 'day':
        day = v;
        break;
      case 'hour':
        hour = v === 24 ? 0 : v; // some engines render midnight as hour 24
        break;
      case 'minute':
        minute = v;
        break;
    }
  }
  return { year, month, day, hour, minute };
}

// `timeZone`'s UTC offset (ms) at the instant `epochMs`: (the wall clock there, read
// as if it were UTC) − the instant. Positive east of UTC (e.g. +2h Berlin summer).
function tzOffsetMs(epochMs: number, timeZone: string): number {
  const p = zonedParts(epochMs, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epochMs;
}

// The UTC instant at which `timeZone`'s wall clock reads year-month-day hh:mm. Inverts
// the offset with one correction pass so it stays right across DST transitions (the
// offset at the naive guess can differ from the offset at the real instant). Date.UTC
// normalizes out-of-range day values, so day+1 rolls into the next month/year cleanly.
function zonedTimeToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = naiveUtc - tzOffsetMs(naiveUtc, timeZone);
  const corrected = naiveUtc - tzOffsetMs(epoch, timeZone);
  if (corrected !== epoch) epoch = corrected;
  return epoch;
}

// Pure: ms from `now` until the next daily "HH:MM". With a `timeZone` (IANA) the time
// is read in that zone (DST-correct, via Intl); without one it falls back to the
// server-local clock (legacy rows). Today if the time is still ahead, else tomorrow.
// Returns null on an invalid format/zone so the caller disables the schedule loudly
// rather than fire at the wrong time.
export function msUntilNextDailyTime(
  at: string,
  now: Date,
  timeZone?: string | null,
): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;

  // No zone → legacy server-local behavior (interpret HH:MM in the process clock).
  if (!timeZone) {
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  // Unknown zone → disable loudly (same contract as a bad HH:MM).
  if (!isValidTimeZone(timeZone)) return null;

  // Today's HH:MM in the zone; if already past, roll to tomorrow (day+1 is DST-safe —
  // Date.UTC normalizes and zonedTimeToEpoch re-derives the offset).
  const today = zonedParts(now.getTime(), timeZone);
  let target = zonedTimeToEpoch(today.year, today.month, today.day, hh, mm, timeZone);
  if (target <= now.getTime()) {
    target = zonedTimeToEpoch(today.year, today.month, today.day + 1, hh, mm, timeZone);
  }
  return target - now.getTime();
}

// ERP-owned daily Bazooka send. The send time + timezone are the editable
// `arsenal_settings` values (changeable in the UI) — NOT env config. The time is
// interpreted in the org's saved IANA timezone (Intl; no date lib). One
// self-rescheduling timer per org with a time set; armed on boot and re-armed
// whenever the setting is edited (the controller calls applyForOrg). Dependency-free
// (no @nestjs/schedule). Scheduling the NEXT future occurrence makes it restart-safe
// (a restart after today's fire schedules tomorrow, never a double-send). In-process:
// in a multi-instance deploy, run one scheduler or use n8n's own schedule.
@Injectable()
export class ArsenalScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArsenalScheduler.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly arsenal: ArsenalService) {}

  async onModuleInit(): Promise<void> {
    const settings = await this.arsenal.settingsWithDailyTime();
    for (const s of settings) {
      this.applyForOrg(s.organizationId, s.bazookaDailyAt, s.bazookaTimezone);
    }
    if (settings.length > 0) {
      this.logger.log(`Daily Bazooka send armed for ${settings.length} org(s).`);
    }
  }

  onModuleDestroy(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // (Re)arm or clear an org's daily Bazooka timer. Called on boot AND on every
  // settings edit, so a changed time/zone takes effect immediately.
  applyForOrg(orgId: string, at: string | null, timeZone: string | null): void {
    const existing = this.timers.get(orgId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(orgId);
    }
    if (!at) return; // disabled / cleared
    if (msUntilNextDailyTime(at, new Date(), timeZone) === null) {
      this.logger.warn(
        `Daily time "${at}" (zone ${timeZone ?? 'server-local'}, org ${orgId}) is invalid — skipped.`,
      );
      return;
    }
    this.scheduleNext(orgId, at, timeZone);
  }

  private scheduleNext(orgId: string, at: string, timeZone: string | null): void {
    const delay = msUntilNextDailyTime(at, new Date(), timeZone);
    if (delay === null) return;
    const timer = setTimeout(() => {
      void this.arsenal
        .run(orgId, 'REACH_BAZOOKA', { source: 'SCHEDULED' })
        .catch((err) =>
          this.logger.error(
            `Scheduled Bazooka send failed (org ${orgId}): ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      this.scheduleNext(orgId, at, timeZone); // re-arm for tomorrow
    }, delay);
    timer.unref?.();
    this.timers.set(orgId, timer);
  }
}

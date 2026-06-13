'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AlarmClock } from 'lucide-react';
import { BAZOOKA_TIMEZONES, DEFAULT_BAZOOKA_TIMEZONE } from '@evertrust/shared';
import {
  useArsenalSettings,
  useUpdateArsenalSettings,
} from '@/hooks/use-arsenal';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// The ERP-editable daily Reach Bazooka send (lives under the sequence strip, beside
// the Bazooka node it controls). A `type="time"` input yields "HH:MM" and the Select
// yields an IANA zone — exactly what the API validates + the scheduler arms on save.
// The send fires at that wall-clock time in the chosen zone (DST-correct), so the
// schedule is explicit rather than tied to the opaque server clock.
export function BazookaSchedule() {
  const t = useTranslations('marketing');
  const settings = useArsenalSettings();
  const update = useUpdateArsenalSettings();
  const [time, setTime] = useState('');
  const [timeZone, setTimeZone] = useState<string>(DEFAULT_BAZOOKA_TIMEZONE);

  const savedTime = settings.data?.bazookaDailyAt ?? null;
  const savedTz = settings.data?.bazookaTimezone ?? null;

  useEffect(() => {
    setTime(savedTime ?? '');
    setTimeZone(savedTz ?? DEFAULT_BAZOOKA_TIMEZONE);
  }, [savedTime, savedTz]);

  function save() {
    if (!time) {
      toast.error(t('bazooka.pickTime'));
      return;
    }
    update.mutate(
      { bazookaDailyAt: time, bazookaTimezone: timeZone },
      {
        onSuccess: () =>
          toast.success(t('bazooka.saved', { time, timezone: timeZone })),
        onError: (e) => toast.error(e.message ?? t('bazooka.saveError')),
      },
    );
  }

  function turnOff() {
    update.mutate(
      { bazookaDailyAt: null, bazookaTimezone: timeZone },
      {
        onSuccess: () => toast.success(t('bazooka.turnedOff')),
        onError: (e) => toast.error(e.message ?? t('bazooka.saveError')),
      },
    );
  }

  const timeDirty = (time || null) !== savedTime;
  const tzDirty = !!time && timeZone !== (savedTz ?? DEFAULT_BAZOOKA_TIMEZONE);
  const dirty = timeDirty || tzDirty;

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
          <AlarmClock className="size-4 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('bazooka.title')}</p>
            {settings.isLoading ? null : savedTime ? (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
              >
                {t('bazooka.onBadge', {
                  time: savedTime,
                  city: savedTz ? zoneCity(savedTz) : t('bazooka.serverTime'),
                })}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t('bazooka.off')}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t.rich('bazooka.extraNote', { em: (chunks) => <em>{chunks}</em> })}
          </p>
          <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
            <span aria-hidden>⚠</span>
            <span>
              {t.rich('bazooka.warning', {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
          </p>

          <Can permission="campaigns:write">
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="grid gap-1">
                <Label
                  htmlFor="bazooka-daily-at"
                  className="text-xs text-muted-foreground"
                >
                  {t('bazooka.time')}
                </Label>
                <Input
                  id="bazooka-daily-at"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="grid gap-1">
                <Label
                  htmlFor="bazooka-timezone"
                  className="text-xs text-muted-foreground"
                >
                  {t('bazooka.timezone')}
                </Label>
                <Select value={timeZone} onValueChange={setTimeZone}>
                  <SelectTrigger id="bazooka-timezone" className="w-[190px]">
                    <SelectValue placeholder={t('bazooka.timezone')} />
                  </SelectTrigger>
                  <SelectContent>
                    {BAZOOKA_TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={update.isPending || !dirty}
              >
                {update.isPending ? t('bazooka.saving') : t('bazooka.save')}
              </Button>
              {savedTime ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={turnOff}
                  disabled={update.isPending}
                  className="text-muted-foreground"
                >
                  {t('bazooka.turnOff')}
                </Button>
              ) : null}
            </div>
          </Can>
        </div>
      </div>
    </div>
  );
}

// City label for the status badge: "Europe/Berlin" → "Berlin", "UTC" → "UTC". A null
// zone is a legacy row still on the server clock — say so honestly.
export function zoneCity(tz: string | null): string {
  if (!tz) return 'server time';
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

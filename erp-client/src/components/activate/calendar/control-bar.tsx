'use client';

import { useTranslations } from 'next-intl';
import {
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Search,
  SquareDot,
} from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { cn } from '@/lib/utils';
import type { CalendarView } from '@/components/activate/calendar/types';

const ALL_CAMPAIGNS = 'all';

// Mon-first order (matches the calendar grid) of weekday numbers (0=Sun..6=Sat),
// for the Business-days toggle list.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
// Stable, locale-agnostic short labels for the toggles (the calendar grid itself
// renders localized weekday names; this compact control uses fixed abbreviations).
const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

export function ControlBar({
  view,
  onViewChange,
  campaignId,
  onCampaignChange,
  campaigns,
  rangeLabel,
  onPrev,
  onNext,
  businessDays,
  onBusinessDaysChange,
  freeOnly,
  onToggleFreeOnly,
}: {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  campaignId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  campaigns: CampaignDto[];
  rangeLabel: string;
  onPrev: () => void;
  onNext: () => void;
  businessDays: number[];
  onBusinessDaysChange: (businessDays: number[]) => void;
  freeOnly: boolean;
  onToggleFreeOnly: () => void;
}) {
  const t = useTranslations('activate');

  // Toggle a weekday in/out of the allowed set, kept sorted for a stable query key.
  const toggleDay = (day: number, checked: boolean) => {
    const next = checked
      ? [...businessDays, day]
      : businessDays.filter((d) => d !== day);
    onBusinessDaysChange([...new Set(next)].sort((a, b) => a - b));
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedTabs
          value={view}
          onValueChange={(v) => onViewChange(v as CalendarView)}
          tabs={[
            { value: 'day', label: t('calendar.views.day'), icon: <SquareDot className="size-4" /> },
            { value: 'week', label: t('calendar.views.week'), icon: <CalendarRange className="size-4" /> },
            { value: 'month', label: t('calendar.views.month'), icon: <CalendarDays className="size-4" /> },
          ]}
        />

        <Select
          value={campaignId ?? ALL_CAMPAIGNS}
          onValueChange={(value) =>
            onCampaignChange(value === ALL_CAMPAIGNS ? null : value)
          }
        >
          <SelectTrigger size="sm" className="h-8 w-44 text-xs">
            <SelectValue placeholder={t('calendar.filter.all')} />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value={ALL_CAMPAIGNS}>{t('calendar.filter.all')}</SelectItem>
            {campaigns.map((campaign) => (
              <SelectItem key={campaign.id} value={campaign.id}>
                {campaign.name ?? t('calendar.filter.untitledCampaign')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={t('calendar.nav.prev')}
            onClick={onPrev}
          >
            <ChevronLeft className="size-4" />
          </Button>

          <span className="min-w-28 text-center text-xs font-semibold text-muted-foreground">
            {rangeLabel}
          </span>

          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-8"
            aria-label={t('calendar.nav.next')}
            onClick={onNext}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
              <CalendarCheck className="size-3.5" />
              {t('calendar.businessDays.label', { count: businessDays.length })}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{t('calendar.businessDays.heading')}</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {WEEKDAY_ORDER.map((day) => (
              <DropdownMenuCheckboxItem
                key={day}
                checked={businessDays.includes(day)}
                // Keep the menu open while toggling several days.
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => toggleDay(day, checked)}
              >
                {WEEKDAY_LABELS[day]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          size="sm"
          variant={freeOnly ? 'default' : 'outline'}
          className={cn(
            'h-8 gap-1.5 text-xs',
            freeOnly
              ? 'bg-emerald-500 text-white hover:bg-emerald-600'
              : 'border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
          )}
          aria-pressed={freeOnly}
          onClick={onToggleFreeOnly}
        >
          <Search className="size-3.5" />
          {freeOnly ? t('calendar.freeSlot.exit') : t('calendar.freeSlot.check')}
        </Button>
      </div>
    </div>
  );
}

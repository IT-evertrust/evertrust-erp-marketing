'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Search, SquareDot } from 'lucide-react';
import type { CampaignDto } from '@evertrust/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SegmentedTabs } from '@/components/rean/segmented-tabs';
import { cn } from '@/lib/utils';
import type { CalendarView } from '@/components/activate/calendar/types';

const ALL_CAMPAIGNS = 'all';

export function ControlBar({
  view,
  onViewChange,
  campaignId,
  onCampaignChange,
  campaigns,
  rangeLabel,
  onPrev,
  onNext,
  onToday,
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
  onToday: () => void;
  freeOnly: boolean;
  onToggleFreeOnly: () => void;
}) {
  const t = useTranslations('activate');

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

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={onToday}
          >
            {t('calendar.nav.today')}
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

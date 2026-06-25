'use client';

import { useTranslations } from 'next-intl';

import type { EngineActivityItem, EngineAlert } from '../types';

type EngineActivityFeedProps = {
  activity: EngineActivityItem[];
  alerts?: EngineAlert[];
  // Shown in place of the feed when it is empty (e.g. a module is selected on the
  // wheel but has no recent runs). Falls back to the generic empty copy.
  emptyHint?: string;
};

// Alert level → dot colour for the source badge. Routine info stays the neutral
// ink; warnings/errors draw the eye.
const ALERT_DOT: Record<EngineAlert['level'], string> = {
  error: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-[#15171c]',
};

// The "Engine Activity" live-log card — a faithful port of the Saloot demo's
// `.ov-engine` feed. Real alerts (when present) ride at the top as tinted rows so
// the operational signal isn't lost; the rest is the live cross-system feed.
export function EngineActivityFeed({ activity, alerts = [], emptyHint }: EngineActivityFeedProps) {
  const t = useTranslations('overview');

  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h3 className="text-[13.5px] font-bold text-[#15171c]">{t('activity.title')}</h3>
        <span className="inline-flex items-center gap-[7px] text-[10px] font-bold tracking-[0.08em] text-[#5b626d]">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#15171c]" />
          {t('activity.liveLog')}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pr-[10px]">
        {alerts.map((alert) => (
          <AlertRow key={alert.id} alert={alert} />
        ))}

        {activity.length === 0 && alerts.length === 0 ? (
          <div className="py-[26px] text-center text-[12px] font-bold text-[#959ca7]">
            {emptyHint ?? t('activity.empty')}
          </div>
        ) : (
          activity.map((item, index) => (
            <ActivityRow key={`${item.at ?? item.time}-${index}`} item={item} />
          ))
        )}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: EngineActivityItem }) {
  return (
    <div className="grid grid-cols-[46px_1fr] gap-3 border-b border-dashed border-[#d6dade] py-[10px] last:border-b-0">
      <span className="text-[10.5px] font-bold text-[#959ca7]">{item.time}</span>
      <div className="min-w-0">
        <span className="mb-[3px] inline-block rounded-[5px] border border-[#d6dade] bg-[#eceef1] px-[6px] py-px text-[9px] font-bold uppercase tracking-[0.1em] text-[#15171c]">
          {item.source}
        </span>
        <div className="text-[12.5px] text-[#5b626d]">{item.message}</div>
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: EngineAlert }) {
  return (
    <div className="grid grid-cols-[46px_1fr] gap-3 border-b border-dashed border-[#d6dade] py-[10px]">
      <span className="text-[10.5px] font-bold text-[#959ca7]">{alert.time}</span>
      <div className="min-w-0">
        <span className="mb-[3px] inline-flex items-center gap-1.5 rounded-[5px] border border-[#d6dade] bg-[#eceef1] px-[6px] py-px text-[9px] font-bold uppercase tracking-[0.1em] text-[#15171c]">
          <span className={`h-1.5 w-1.5 rounded-full ${ALERT_DOT[alert.level]}`} />
          {alert.source}
        </span>
        <div className="text-[12.5px] font-bold text-[#15171c]">{alert.title}</div>
        {alert.detail ? (
          <div className="text-[11.5px] leading-snug text-[#5b626d]">{alert.detail}</div>
        ) : null}
      </div>
    </div>
  );
}

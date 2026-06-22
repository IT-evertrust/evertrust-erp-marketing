import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { ActivityLevel, EngineActivityItem, EngineAlert } from '../types';

type EngineActivityFeedProps = {
  activity: EngineActivityItem[];
  alerts?: EngineAlert[];
};

// Level -> dot colour. Info stays the neutral ink so routine activity reads calm and only
// warnings/errors/successes draw the eye.
const LEVEL_DOT: Record<ActivityLevel, string> = {
  info: '#959ca7',
  success: '#2f855a',
  warning: '#b7791f',
  error: '#c0392b',
};
const ALERT_ACCENT: Record<EngineAlert['level'], { border: string; bg: string; text: string }> = {
  error: { border: '#e3b4ad', bg: '#fbeeec', text: '#9b2c1f' },
  warning: { border: '#e7d4a8', bg: '#fbf5e6', text: '#8a6212' },
  info: { border: '#d6dade', bg: '#f6f7f9', text: '#5b626d' },
};

export function EngineActivityFeed({ activity, alerts = [] }: EngineActivityFeedProps) {
  return (
    <GrowthCard
      title="Engine Activity"
      hint={
        <span className="inline-flex items-center gap-2">
          <LiveDot />
          Live log
        </span>
      }
    >
      {alerts.length > 0 ? (
        <div className="mb-3">
          <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
            Alerts · {alerts.length}
          </div>
          <div className="flex flex-col gap-1.5">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="max-h-[420px] overflow-y-auto pr-2">
        {activity.length === 0 ? (
          <div className="py-6 text-center text-[12px] font-bold text-[#959ca7]">
            No engine activity yet.
          </div>
        ) : (
          activity.map((item, index) => (
            <ActivityRow key={`${item.at ?? item.time}-${index}`} item={item} index={index} />
          ))
        )}
      </div>
    </GrowthCard>
  );
}

function AlertRow({ alert }: { alert: EngineAlert }) {
  const accent = ALERT_ACCENT[alert.level];
  return (
    <div
      className="rounded-[8px] border px-3 py-2 duration-300 animate-in fade-in zoom-in-95"
      style={{ borderColor: accent.border, backgroundColor: accent.bg }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[12px] font-bold" style={{ color: accent.text }}>
          {alert.title}
        </div>
        <span className="shrink-0 text-[10px] font-bold text-[#959ca7]">{alert.time}</span>
      </div>
      {alert.detail ? (
        <div className="mt-0.5 text-[11.5px] leading-snug text-[#5b626d]">{alert.detail}</div>
      ) : null}
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
        {alert.source}
      </div>
    </div>
  );
}

function ActivityRow({ item, index = 0 }: { item: EngineActivityItem; index?: number }) {
  const dot = LEVEL_DOT[item.level ?? 'info'];
  return (
    <div
      className="grid grid-cols-[46px_1fr] gap-3 rounded-md border-b border-dashed border-[#d6dade] px-1 py-2.5 -mx-1 transition-colors duration-150 last:border-b-0 hover:bg-[#f6f7f9] fill-mode-both animate-in fade-in"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <span className="text-[10.5px] font-bold text-[#959ca7]">{item.time}</span>

      <div>
        <span className="mb-1 inline-flex items-center gap-1.5 rounded-[5px] border border-[#d6dade] bg-[#eceef1] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.1em] text-[#15171c]">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: dot }}
          />
          {item.source}
        </span>
        <div className="text-[12.5px] text-[#5b626d]">{item.message}</div>
      </div>
    </div>
  );
}

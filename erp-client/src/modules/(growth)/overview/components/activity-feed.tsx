import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { ActivityLevel, EngineActivityItem, EngineAlert } from '../types';

type EngineActivityFeedProps = {
  activity: EngineActivityItem[];
  alerts?: EngineAlert[];
};

// Level -> dot colour. Info stays the neutral ink so routine activity reads calm and only
// warnings/errors/successes draw the eye. Dots are saturated brand colours that read on both
// light and dark surfaces.
const LEVEL_DOT: Record<ActivityLevel, string> = {
  info: 'bg-muted-foreground',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};
// Tinted alert rows: pale tint + darker ink in light, deep tint + light ink in dark.
const ALERT_ACCENT: Record<EngineAlert['level'], { box: string; text: string }> = {
  error: {
    box: 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
    text: 'text-red-800 dark:text-red-300',
  },
  warning: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
    text: 'text-amber-800 dark:text-amber-300',
  },
  info: {
    box: 'border-border bg-muted',
    text: 'text-muted-foreground',
  },
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
          <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
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
          <div className="py-6 text-center text-[12px] font-bold text-muted-foreground">
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
      className={[
        'rounded-[8px] border px-3 py-2 duration-300 animate-in fade-in zoom-in-95',
        accent.box,
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={['text-[12px] font-bold', accent.text].join(' ')}>
          {alert.title}
        </div>
        <span className="shrink-0 text-[10px] font-bold text-muted-foreground">{alert.time}</span>
      </div>
      {alert.detail ? (
        <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{alert.detail}</div>
      ) : null}
      <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {alert.source}
      </div>
    </div>
  );
}

function ActivityRow({ item, index = 0 }: { item: EngineActivityItem; index?: number }) {
  const dot = LEVEL_DOT[item.level ?? 'info'];
  return (
    <div
      className="grid grid-cols-[46px_1fr] gap-3 rounded-md border-b border-dashed border-border px-1 py-2.5 -mx-1 transition-colors duration-150 last:border-b-0 hover:bg-muted fill-mode-both animate-in fade-in"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <span className="text-[10.5px] font-bold text-muted-foreground">{item.time}</span>

      <div>
        <span className="mb-1 inline-flex items-center gap-1.5 rounded-[5px] border border-border bg-muted px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.1em] text-foreground">
          <span
            className={['inline-block h-1.5 w-1.5 rounded-full', dot].join(' ')}
          />
          {item.source}
        </span>
        <div className="text-[12.5px] text-muted-foreground">{item.message}</div>
      </div>
    </div>
  );
}

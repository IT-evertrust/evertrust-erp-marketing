import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { ActivityLevel, EngineActivityItem, EngineAlert } from '../types';

type EngineActivityFeedProps = {
  activity: EngineActivityItem[];
  alerts?: EngineAlert[];
  // When a wheel module is focused, narrow the log to that module's runs. Matched
  // loosely (name/stage/key against the row's source) so it degrades gracefully:
  // a module with no matching live activity shows the per-module empty state rather
  // than silently hiding the whole feed.
  activeModule?: { name: string; stage: string; key: string } | null;
};

function matchesModule(
  item: EngineActivityItem,
  mod: { name: string; stage: string; key: string },
): boolean {
  const haystack = `${item.source} ${item.message}`.toLowerCase();
  return (
    haystack.includes(mod.name.toLowerCase()) ||
    haystack.includes(mod.stage.toLowerCase()) ||
    haystack.includes(mod.key.toLowerCase())
  );
}

// Level -> dot colour. Info stays the neutral ink so routine activity reads calm and only
// warnings/errors/successes draw the eye.
const LEVEL_DOT: Record<ActivityLevel, string> = {
  info: '#959ca7',
  success: '#2f855a',
  warning: '#b7791f',
  error: '#c0392b',
};
// Alerts ARE recent activity — fold them into the one live-log feed (as priority
// rows, on top) so the card reads exactly like the mock's single scrolling Engine
// Activity log rather than a separate banner block.
function alertToItem(a: EngineAlert): EngineActivityItem {
  return {
    time: a.time,
    source: a.source,
    message: a.detail ? `${a.title} — ${a.detail}` : a.title,
    level: a.level,
  };
}

export function EngineActivityFeed({
  activity,
  alerts = [],
  activeModule = null,
}: EngineActivityFeedProps) {
  const merged = [...alerts.map(alertToItem), ...activity];
  const shown = activeModule
    ? merged.filter((item) => matchesModule(item, activeModule))
    : merged;
  return (
    <GrowthCard
      title="Engine Activity"
      className="flex h-full flex-col overflow-hidden"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      hint={
        <span className="inline-flex items-center gap-2">
          <LiveDot />
          Live log
        </span>
      }
    >
      {/* The feed fills the card and scrolls INSIDE it — never overflowing into the
          funnel row below (the previous fixed max-h + content above caused the bleed). */}
      <div className="max-h-[460px] min-h-0 flex-1 overflow-y-auto pr-2">
        {shown.length === 0 ? (
          <div className="py-6 text-center text-[12px] font-bold text-[#959ca7]">
            {activeModule ? 'No recent runs for this module.' : 'No engine activity yet.'}
          </div>
        ) : (
          shown.map((item, index) => (
            <ActivityRow key={`${item.at ?? item.time}-${index}`} item={item} index={index} />
          ))
        )}
      </div>
    </GrowthCard>
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

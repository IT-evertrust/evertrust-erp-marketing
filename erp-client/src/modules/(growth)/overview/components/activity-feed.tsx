import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { EngineActivityItem } from '../types';

type EngineActivityFeedProps = {
  activity: EngineActivityItem[];
};

export function EngineActivityFeed({ activity }: EngineActivityFeedProps) {
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
      <div className="max-h-[420px] overflow-y-auto pr-2">
        {activity.map((item, index) => (
          <ActivityRow key={`${item.time}-${index}`} item={item} />
        ))}
      </div>
    </GrowthCard>
  );
}

function ActivityRow({ item }: { item: EngineActivityItem }) {
  return (
    <div className="grid grid-cols-[46px_1fr] gap-3 border-b border-dashed border-[#d6dade] py-2.5 last:border-b-0">
      <span className="text-[10.5px] font-bold text-[#959ca7]">
        {item.time}
      </span>

      <div>
        <span className="mb-1 inline-block rounded-[5px] border border-[#d6dade] bg-[#eceef1] px-1.5 py-px text-[9px] font-bold uppercase tracking-[0.1em] text-[#15171c]">
          {item.source}
        </span>
        <div className="text-[12.5px] text-[#5b626d]">{item.message}</div>
      </div>
    </div>
  );
}
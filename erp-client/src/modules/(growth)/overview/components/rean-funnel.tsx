import { GrowthCard } from '@/modules/(growth)/shared';

import type { FunnelStage } from '../types';

type ReanFunnelProps = {
  stages: FunnelStage[];
};

export function ReanFunnel({ stages }: ReanFunnelProps) {
  return (
    <GrowthCard title="R.E.A.N Funnel" hint="Reach → Nurture">
      <div className="flex flex-col gap-3">
        {stages.map((stage) => (
          <FunnelRow key={stage.name} stage={stage} />
        ))}
      </div>
    </GrowthCard>
  );
}

function FunnelRow({ stage }: { stage: FunnelStage }) {
  const width = Math.max(0, Math.min(100, stage.width));

  return (
    <div className="grid grid-cols-[108px_1fr_50px] items-center gap-3">
      <span className="text-[12.5px] text-[#5b626d]">{stage.name}</span>

      <div className="relative h-[26px] overflow-hidden rounded-md border border-[#d6dade] bg-[#eceef1]">
        <div
          className="absolute inset-y-0 left-0 flex items-center bg-[#15171c] pl-2.5 text-[11px] font-bold text-white transition-all duration-700"
          style={{ width: `${width}%` }}
        >
          {stage.value}
        </div>
      </div>

      <span className="text-right text-[10.5px] font-bold text-[#959ca7]">
        {stage.conversion}
      </span>
    </div>
  );
}
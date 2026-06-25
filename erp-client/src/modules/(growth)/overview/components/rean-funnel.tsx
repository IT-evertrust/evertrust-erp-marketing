'use client';

import { useTranslations } from 'next-intl';

import type { FunnelStage } from '../types';

type ReanFunnelProps = {
  stages: FunnelStage[];
};

// The R.E.A.N funnel card — a faithful port of the Saloot demo's `#ovFunnel`:
// five stage rows that stretch to fill the card height, each a dark fill bar with
// the value inside and the conversion % on the right. Copy stays i18n; the
// numbers come from the live `useOverview` data.
export function ReanFunnel({ stages }: ReanFunnelProps) {
  const t = useTranslations('overview');

  return (
    <div className="flex min-w-0 flex-col rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="flex items-center justify-between border-b border-[#e4e7eb] px-4 py-[15px]">
        <h3 className="text-[13.5px] font-bold text-[#15171c]">{t('funnel.title')}</h3>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        {stages.map((stage) => (
          <FunnelRow key={stage.nameKey} stage={stage} />
        ))}
      </div>
    </div>
  );
}

function FunnelRow({ stage }: { stage: FunnelStage }) {
  const t = useTranslations('overview');
  const width = Math.max(0, Math.min(100, stage.width));

  return (
    <div className="grid flex-1 grid-cols-[84px_1fr_84px] items-center gap-3">
      <span className="text-[12.5px] text-[#5b626d]">
        {t(`funnel.stage.${stage.nameKey}`)}
      </span>

      {/* Center the fill so every stage's bar shares one middle axis and extends
          out symmetrically (a true funnel/pyramid), rather than left-anchoring. */}
      <div className="flex h-full items-stretch justify-center">
        <div
          className="flex h-full min-w-[44px] items-center justify-center rounded-[8px] bg-[#15171c] text-[11px] font-bold text-white transition-[width] duration-700"
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

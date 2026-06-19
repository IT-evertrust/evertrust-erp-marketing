'use client';

import { usePathname } from 'next/navigation';

import { getGrowthPageMeta } from '../services/growth-nav';

export function GrowthTopbar() {
  const pathname = usePathname();
  const meta = getGrowthPageMeta(pathname);
  const Icon = meta.icon;

  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-[#e4e7eb] bg-[rgba(238,240,243,0.82)] px-6 py-[18px] backdrop-blur">
      <div className="flex items-center gap-3">
        <Icon className="h-[26px] w-[26px] stroke-[2]" />

        <div>
          <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em] text-[#15171c]">
            {meta.title}
          </h1>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
            {meta.subtitle}
          </div>
        </div>
      </div>

      <div className="flex-1" />
    </header>
  );
}
'use client';

import { useTranslations } from 'next-intl';

import type { ReachTab } from '../types';

type ReachTabsProps = {
  activeTab: ReachTab;
  onChange: (tab: ReachTab) => void;
};

const TAB_IDS: ReachTab[] = ['scraper', 'generator', 'sender', 'templates'];

export function ReachTabs({ activeTab, onChange }: ReachTabsProps) {
  const t = useTranslations('reach');

  return (
    <div className="mb-4 flex flex-wrap gap-0 border-b border-border">
      {TAB_IDS.map((id) => {
        const active = activeTab === id;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={[
              'mb-[-1px] border-b-2 px-4 py-3 text-[13px] font-bold transition',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t(`tabs.${id}`)}
          </button>
        );
      })}
    </div>
  );
}
import type { ActivateTab } from '../types';

type ActivateTabsProps = {
  activeTab: ActivateTab;
  onChange: (tab: ActivateTab) => void;
};

const TABS: Array<{ id: ActivateTab; label: string }> = [
  { id: 'booker', label: 'Meeting Booker' },
  { id: 'research', label: 'Company Research' },
  { id: 'aftersales', label: 'After-Sales Analysis' },
];

export function ActivateTabs({ activeTab, onChange }: ActivateTabsProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-0 border-b border-[#e4e7eb]">
      {TABS.map((tab) => {
        const active = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              'mb-[-1px] border-b-2 px-4 py-3 text-[13px] font-bold transition',
              active
                ? 'border-[#15171c] text-[#15171c]'
                : 'border-transparent text-[#959ca7] hover:text-[#5b626d]',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
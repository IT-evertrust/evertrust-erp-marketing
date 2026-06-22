import type { ReachTab } from '../types';

type ReachTabsProps = {
  activeTab: ReachTab;
  onChange: (tab: ReachTab) => void;
};

const TABS: Array<{ id: ReachTab; label: string }> = [
  { id: 'scraper', label: 'Lead Scraper' },
  { id: 'generator', label: 'Email Generator' },
  { id: 'sender', label: 'Sequence Sender' },
];

export function ReachTabs({ activeTab, onChange }: ReachTabsProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-0 border-b border-border">
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
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export type SegmentedTab = {
  // Stable value used by the controlled Tabs root.
  value: string;
  // Tab label.
  label: ReactNode;
  // Optional leading icon (e.g. a lucide icon element).
  icon?: ReactNode;
};

// A bordered pill group whose active tab is a neutral raised pill (white bg +
// foreground text + subtle shadow) — no brand-green accent, so it doesn't clash
// with the calendar's color-coded event cards. A thin styled wrapper over the
// shadcn Tabs primitive so pages get the look without re-skinning every tab.
//
// Renders only the tab strip (TabsList). Pair it with shadcn `TabsContent`
// inside the same `<Tabs>` if you need it, or use it controlled (value +
// onValueChange) to switch your own panes.
export function SegmentedTabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  className,
}: {
  tabs: SegmentedTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <Tabs
      value={value}
      defaultValue={defaultValue ?? tabs[0]?.value}
      onValueChange={onValueChange}
      className={cn('w-fit', className)}
    >
      <TabsList className="h-auto rounded-[10px] border bg-card p-1">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className={cn(
              'gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground',
              // Neutral active segment (raised white pill) — no clashing brand-green.
              'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
            )}
          >
            {t.icon}
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

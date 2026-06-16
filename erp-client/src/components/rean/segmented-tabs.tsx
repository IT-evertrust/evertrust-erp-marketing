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

// The mockup's `.tabs` / `.tab` / `.tab.on` segmented control (style block
// lines 96–101): a bordered pill group whose active tab gets the emerald-soft
// background + emerald text. This is a thin styled wrapper over the shadcn Tabs
// primitive so pages get the prototype look without re-skinning every tab.
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
              'data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-600 data-[state=active]:shadow-none',
              'dark:data-[state=active]:bg-emerald-500/10 dark:data-[state=active]:text-emerald-400 dark:data-[state=active]:border-transparent',
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

import type { ReactNode } from 'react';

import { GrowthSidebar } from './growth-sidebar';
import { GrowthTopbar } from './growth-topbar';

type GrowthShellProps = {
  children: ReactNode;
};

export function GrowthShell({ children }: GrowthShellProps) {
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-background font-sans text-foreground">
      <GrowthSidebar />

      <div className="min-w-0">
        <GrowthTopbar />
        {children}
      </div>
    </div>
  );
}
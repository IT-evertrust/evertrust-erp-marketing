import type { ReactNode } from 'react';

import { GrowthShell } from '@/modules/(growth)/shell';

type GrowthLayoutProps = {
  children: ReactNode;
};

export default function GrowthLayout({ children }: GrowthLayoutProps) {
  return <GrowthShell>{children}</GrowthShell>;
}
'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { getGrowthPageMeta } from '../services/growth-nav';

// The single masthead for the whole app: page icon + title + subtitle. Account
// controls (notifications + user menu) were moved off the topbar — the sidebar
// footer now carries the user identity + logout. Pages render NO header of their
// own, so this title is the only one (no Dashboard/Overview double-header).
export function GrowthTopbar() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const meta = getGrowthPageMeta(pathname);
  const Icon = meta.icon;

  return (
    <header className="sticky top-0 z-10 flex h-20 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-3">
        <Icon className="h-[26px] w-[26px] stroke-[2] text-foreground" />

        <div>
          <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">
            {t(meta.i18nKey, { default: meta.title })}
          </h1>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {t(meta.subtitleKey, { default: meta.subtitle })}
          </div>
        </div>
      </div>

      <div className="flex-1" />
    </header>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useLocale } from 'next-intl';
import { cn } from '@/lib/utils';

// EN/DE segmented language switch for the topbar. Persists the choice in the
// NEXT_LOCALE cookie (cookie/preference mode — no locale URL segment; see
// src/i18n/request.ts) and calls router.refresh() so the server re-renders with
// the new messages immediately. Mirrors the switch in Settings → General.
const LOCALES = ['en', 'de'] as const;
type Locale = (typeof LOCALES)[number];

export function LanguageToggle() {
  const locale = useLocale();
  const router = useRouter();

  function setLocale(next: Locale) {
    if (next === locale) return;
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className="hidden h-8 items-center overflow-hidden rounded-md border sm:inline-flex"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l, i) => {
        const active = locale === l;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={active}
            className={cn(
              'h-full px-2.5 text-xs font-semibold uppercase tracking-wide transition-colors',
              i > 0 && 'border-l',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Languages, Monitor, Moon, Sun, Rows3, Rows4 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getDensity,
  getLandingPath,
  LANDING_OPTIONS,
  setDensity,
  setLandingPath,
  type Density,
} from '@/lib/preferences';
import { cn } from '@/lib/utils';

// The theme choices next-themes understands. "system" follows the OS; the other
// two force a palette (globals.css defines :root = light and .dark = dark).
// labelKey indexes settings.general.appearance.* (resolved at render).
const THEME_OPTIONS: { value: string; labelKey: string; icon: LucideIcon }[] = [
  { value: 'system', labelKey: 'system', icon: Monitor },
  { value: 'light', labelKey: 'light', icon: Sun },
  { value: 'dark', labelKey: 'dark', icon: Moon },
];

// Density choices. "comfortable" is the app default (--spacing 0.25rem);
// "compact" tightens the global spacing scale to 0.2rem (see globals.css).
// labelKey indexes settings.general.display.* (resolved at render).
const DENSITY_OPTIONS: { value: Density; labelKey: string; icon: LucideIcon }[] = [
  { value: 'comfortable', labelKey: 'comfortable', icon: Rows3 },
  { value: 'compact', labelKey: 'compact', icon: Rows4 },
];

// The two supported app locales. labelKey indexes settings.general.language.*.
const LANGUAGE_OPTIONS: { value: 'en' | 'de'; labelKey: string }[] = [
  { value: 'en', labelKey: 'english' },
  { value: 'de', labelKey: 'german' },
];

const LANDING_LABELS: Record<string, string> = Object.fromEntries(
  LANDING_OPTIONS.map((o) => [o.path, o.label]),
);

// General settings = app/website preferences for the signed-in user. NOT the user
// profile (name/role/org/log-out) — that lives in the avatar menu → /users/[id].
// Surfaces: Appearance (theme), Display (landing + density), and Language
// (English / Deutsch, persisted in the NEXT_LOCALE cookie).
export function GeneralSettings() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  // next-themes only resolves the active theme on the client, so the selected value
  // is unknown during SSR / first paint. Gate the controls on `mounted` to avoid a
  // hydration mismatch (render a skeleton until we know the real value). The same
  // gate covers the localStorage-backed display preferences below.
  const [mounted, setMounted] = useState(false);
  // Display preferences live in localStorage (see @/lib/preferences). Seed them
  // after mount so SSR and first paint render the defaults, then reconcile.
  const [landing, setLanding] = useState(() => getLandingPath());
  const [density, setDensityState] = useState<Density>('comfortable');
  useEffect(() => {
    setMounted(true);
    setLanding(getLandingPath());
    setDensityState(getDensity());
  }, []);

  // Persist the chosen landing page; it takes effect on the next sign-in
  // (useGoogleLogin redirects to getLandingPath()).
  function handleLandingChange(path: string) {
    setLanding(path);
    setLandingPath(path);
    toast.success(
      t('general.display.landingToast', { label: LANDING_LABELS[path] ?? path }),
    );
  }

  // Apply density immediately (so the spacing change is visible without a
  // reload) and persist it. "comfortable" is the default → drop the attribute.
  function handleDensityChange(value: Density) {
    setDensityState(value);
    setDensity(value);
    if (value === 'comfortable') {
      delete document.documentElement.dataset.density;
    } else {
      document.documentElement.dataset.density = value;
    }
    toast.success(
      t('general.display.densityToast', {
        label: t(`general.display.${value}`),
      }),
    );
  }

  // Persist the chosen UI language in the NEXT_LOCALE cookie (cookie/preference
  // mode — no locale URL segment; see src/i18n/request.ts). router.refresh()
  // re-runs the server render so the new messages take effect immediately.
  function handleLanguageChange(value: string) {
    if (value === locale) return;
    document.cookie = `NEXT_LOCALE=${value}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
    toast.success(
      t('general.language.toast', {
        label: t(`general.language.${value === 'de' ? 'german' : 'english'}`),
      }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('general.header.title')}
        description={t('general.header.description')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('general.appearance.title')}</CardTitle>
          <CardDescription>
            {t('general.appearance.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!mounted ? (
            <Skeleton className="h-[68px] w-full max-w-sm rounded-lg" />
          ) : (
            <div
              role="radiogroup"
              aria-label={t('general.appearance.ariaLabel')}
              className="grid max-w-sm grid-cols-3 gap-1.5 rounded-lg border bg-muted/40 p-1.5"
            >
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                // Default to "dark" when no explicit choice is stored yet.
                const active = (theme ?? 'dark') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(opt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4" />
                    {t(`general.appearance.${opt.labelKey}`)}
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('general.display.title')}</CardTitle>
          <CardDescription>
            {t('general.display.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {!mounted ? (
            <Skeleton className="h-[68px] w-full max-w-sm rounded-lg" />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="landing-page">
                  {t('general.display.landingLabel')}
                </Label>
                <Select value={landing} onValueChange={handleLandingChange}>
                  <SelectTrigger id="landing-page" className="max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANDING_OPTIONS.map((opt) => (
                      <SelectItem key={opt.path} value={opt.path}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('general.display.landingHint')}
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label id="density-label">
                  {t('general.display.densityLabel')}
                </Label>
                <div
                  role="radiogroup"
                  aria-labelledby="density-label"
                  className="grid max-w-sm grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-1.5"
                >
                  {DENSITY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = density === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => handleDensityChange(opt.value)}
                        className={cn(
                          'flex flex-col items-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-medium transition-colors',
                          active
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Icon className="size-4" />
                        {t(`general.display.${opt.labelKey}`)}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('general.display.densityHint')}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('general.language.title')}</CardTitle>
          <CardDescription>
            {t('general.language.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={t('general.language.ariaLabel')}
            className="grid max-w-sm grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-1.5"
          >
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = locale === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => handleLanguageChange(opt.value)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Languages className="size-4" />
                  {t(`general.language.${opt.labelKey}`)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

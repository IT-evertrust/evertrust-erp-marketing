'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Building2, Languages, Monitor, Moon, Sun, Rows3, Rows4, SlidersHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMe } from '@/hooks/use-auth';
import { GrowthCard } from '@/modules/(growth)/shared';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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

// Shared eyebrow label — uppercase, tracked, muted. Matches the GrowthShell idiom.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </span>
  );
}

// A segmented radio group rendered in the GrowthShell pill idiom: a bordered,
// muted track with the active option lifted onto the card surface.
function SegmentedGroup({
  ariaLabel,
  ariaLabelledBy,
  columns,
  children,
}: {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  columns: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        'grid max-w-sm gap-1.5 rounded-[10px] border border-sidebar-border bg-muted p-1.5',
        columns === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}
    >
      {children}
    </div>
  );
}

function SegmentedOption({
  active,
  onClick,
  icon: Icon,
  label,
  stacked = true,
}: {
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  stacked?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-2.5 text-xs font-medium transition-colors',
        stacked ? 'flex-col' : 'justify-center',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

// General settings = app/website preferences for the signed-in user. NOT the user
// profile (name/role/org/log-out) — that lives in the avatar menu → /users/[id].
// Surfaces: Appearance (theme), Display (landing + density), and Language
// (English / Deutsch, persisted in the NEXT_LOCALE cookie).
export function GeneralSettings() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const router = useRouter();
  const me = useMe();
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
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <header className="mb-5 flex items-center gap-3 border-b border-sidebar-border pb-5">
        <SlidersHorizontal className="h-7 w-7 stroke-[2] text-foreground" />
        <div>
          <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">
            {t('general.header.title')}
          </h1>
          <div className="mt-2">
            <Eyebrow>{t('general.header.description')}</Eyebrow>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        {/* Organization profile — the org name is REAL (resolved from the signed-in
            session via useMe). There is no org-update API yet, so the name is shown
            read-only and the timezone is a placeholder default; both are flagged
            "coming soon" rather than faking a save. */}
        <GrowthCard
          title={t('general.org.title')}
          hint={
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" />
              {t('general.org.description')}
            </span>
          }
        >
          <div className="flex max-w-md flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="org-name">
                <Eyebrow>{t('general.org.nameLabel')}</Eyebrow>
              </Label>
              {me.isLoading ? (
                <Skeleton className="h-9 w-full rounded-md" />
              ) : (
                <Input
                  id="org-name"
                  value={me.data?.organizationName ?? ''}
                  placeholder={t('general.org.namePlaceholder')}
                  readOnly
                  aria-readonly
                />
              )}
              <p className="text-xs text-muted-foreground">
                {t('general.org.nameHint')}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="org-timezone">
                  <Eyebrow>{t('general.org.timezoneLabel')}</Eyebrow>
                </Label>
                <Badge variant="secondary" className="text-[10px]">
                  {t('general.org.comingSoon')}
                </Badge>
              </div>
              <Select value="Europe/Berlin" disabled>
                <SelectTrigger id="org-timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Europe/Berlin">Europe/Berlin</SelectItem>
                  <SelectItem value="Europe/London">Europe/London</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t('general.org.timezoneHint')}
              </p>
            </div>
          </div>
        </GrowthCard>

        <GrowthCard title={t('general.appearance.title')}>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('general.appearance.description')}
          </p>
          {!mounted ? (
            <Skeleton className="h-[68px] w-full max-w-sm rounded-[10px]" />
          ) : (
            <SegmentedGroup
              ariaLabel={t('general.appearance.ariaLabel')}
              columns={3}
            >
              {THEME_OPTIONS.map((opt) => (
                <SegmentedOption
                  key={opt.value}
                  // Default to "dark" when no explicit choice is stored yet.
                  active={(theme ?? 'dark') === opt.value}
                  onClick={() => setTheme(opt.value)}
                  icon={opt.icon}
                  label={t(`general.appearance.${opt.labelKey}`)}
                />
              ))}
            </SegmentedGroup>
          )}
        </GrowthCard>

        <GrowthCard title={t('general.display.title')}>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('general.display.description')}
          </p>
          {!mounted ? (
            <Skeleton className="h-[68px] w-full max-w-sm rounded-[10px]" />
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="landing-page">
                  <Eyebrow>{t('general.display.landingLabel')}</Eyebrow>
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
                  <Eyebrow>{t('general.display.densityLabel')}</Eyebrow>
                </Label>
                <SegmentedGroup ariaLabelledBy="density-label" columns={2}>
                  {DENSITY_OPTIONS.map((opt) => (
                    <SegmentedOption
                      key={opt.value}
                      active={density === opt.value}
                      onClick={() => handleDensityChange(opt.value)}
                      icon={opt.icon}
                      label={t(`general.display.${opt.labelKey}`)}
                    />
                  ))}
                </SegmentedGroup>
                <p className="text-xs text-muted-foreground">
                  {t('general.display.densityHint')}
                </p>
              </div>
            </div>
          )}
        </GrowthCard>

        <GrowthCard title={t('general.language.title')}>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('general.language.description')}
          </p>
          <SegmentedGroup
            ariaLabel={t('general.language.ariaLabel')}
            columns={2}
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <SegmentedOption
                key={opt.value}
                active={locale === opt.value}
                onClick={() => handleLanguageChange(opt.value)}
                icon={Languages}
                label={t(`general.language.${opt.labelKey}`)}
                stacked={false}
              />
            ))}
          </SegmentedGroup>
        </GrowthCard>
      </div>
    </main>
  );
}

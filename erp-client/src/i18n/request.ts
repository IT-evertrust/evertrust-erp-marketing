import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

// Cookie-based (routing-free) i18n. We deliberately do NOT use next-intl's
// locale-segment routing: a `/en/`, `/de/` URL prefix would collide with the
// auth gating in src/middleware.ts. The active locale is read from the
// NEXT_LOCALE cookie (set by the Language switcher in Settings → General) and
// defaults to English.
const LOCALES = ['en', 'de'] as const;
type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

// Messages are split into one file per namespace under messages/<locale>/<ns>.json
// so translators can add/edit namespaces in parallel without touching a shared
// file. This array is the single source of truth for which namespaces exist;
// the merge below reassembles them into the same top-level shape the app expects
// (top-level key === namespace), so `useTranslations('settings')` etc. resolve
// unchanged. Add a namespace here AND create messages/{en,de}/<ns>.json for it.
const NAMESPACES = [
  // Existing
  'nav',
  'common',
  'settings',
  'growth',
  // Planned (currently empty {} stubs — translators fill these in)
  'dashboard',
  'tenders',
  'suppliers',
  'customers',
  'sales',
  'keyAccount',
  'performance',
  'users',
  'marketing',
  'login',
] as const;

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(
    cookieLocale ?? '',
  )
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  const messages: Record<string, unknown> = {};
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      messages[ns] = (
        await import(`../../messages/${locale}/${ns}.json`)
      ).default;
    }),
  );

  return {
    locale,
    messages,
  };
});

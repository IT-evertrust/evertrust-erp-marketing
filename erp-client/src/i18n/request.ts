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

export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get('NEXT_LOCALE')?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(
    cookieLocale ?? '',
  )
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

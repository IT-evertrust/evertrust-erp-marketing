import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Providers } from './providers';

// The whole app runs on Geist (matches Kobe's GrowthShell design): --font-sans
// drives the shell + every page, --font-mono backs code/ID/permission chips. One
// type system everywhere — no per-page font overrides.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Evertrust ERP — Tender operations, automated',
  description:
    'AI-assisted operations platform for public-tender businesses. Automate intake to submission with a full audit trail, built for German procurement.',
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Locale + messages are resolved from the NEXT_LOCALE cookie (see
  // src/i18n/request.ts). NextIntlClientProvider wraps OUTSIDE Providers so every
  // client component below the tree can call useTranslations/useLocale.
  // suppressHydrationWarning stays — next-themes toggles a class on <html>.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geist.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}

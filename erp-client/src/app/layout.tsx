import type { Metadata } from 'next';
import { Fraunces, IBM_Plex_Mono, Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import './globals.css';
import { GrowthShell } from '@/modules/(growth)/shell';
import { Providers } from './providers';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

// Display + mono are used by the marketing landing for a distinctive, "operations
// console" character. They expose CSS variables only; the app shell keeps Inter,
// so loading these adds two fonts to the landing without restyling the product.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  axes: ['opsz', 'SOFT', 'WONK'],
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

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
        className={`${inter.variable} ${fraunces.variable} ${plexMono.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

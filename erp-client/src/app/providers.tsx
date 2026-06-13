'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from '@/components/ui/sonner';
import { PreferencesBoot } from '@/components/settings/preferences-boot';

// App-wide client providers. QueryClient lives in state so it's created once per
// browser session (never shared across requests).
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is fetched in the browser, never at build time.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Theme is user-switchable from Settings → General (next-themes persists the
          choice in localStorage). Default stays dark to preserve the existing look;
          "system" follows the OS, light/dark force a palette. globals.css defines
          both :root (light) and .dark. */}
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        {/* Applies the stored display-density preference to <html> before paint,
            on every route (density is independent of next-themes). */}
        <PreferencesBoot />
        {children}
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

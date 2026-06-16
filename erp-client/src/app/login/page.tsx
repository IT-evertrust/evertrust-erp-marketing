'use client';

import { useTranslations } from 'next-intl';
import { LoginForm } from '@/components/auth/login-form';

// Data fetching here is fully client-side (the login mutation runs on the Google
// credential callback), so nothing hits the API at build time. The surface is a
// single sign-in panel over a faint token-based blueprint wash — restyle only; auth
// lives in <LoginForm> / <GoogleSignInButton>.
export default function LoginPage() {
  const t = useTranslations('login');

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4">
      {/* Ambient depth, all token-based (no new colours / CSS file): a faint blueprint
          grid masked to the centre + two soft glows over the dark base. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.06) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage:
              'radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent 75%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent 75%)',
          }}
        />
        <div className="absolute -top-32 left-1/2 size-[34rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px]" />
        <div className="absolute -bottom-40 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-muted-foreground/[0.06] blur-[140px]" />
      </div>

      <div className="relative flex w-full max-w-sm flex-col items-center gap-7">
        <LoginForm />
        <p className="text-center text-xs text-muted-foreground/70">
          {t('brand.footer')}
        </p>
      </div>
    </main>
  );
}

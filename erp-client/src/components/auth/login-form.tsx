'use client';

import { useTranslations } from 'next-intl';
import { Crosshair, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';

// Google-only sign-in surface — ONE designed panel: the brand lockup, the single
// Google action (the clear primary CTA), and the company hint. The email/password
// form was removed (the API disabled POST /auth/login → 403 and only accepts the
// Google paths); all sign-in logic + error handling lives in <GoogleSignInButton>.
// The brand mark is a white Crosshair on a solid black badge.
export function LoginForm() {
  const t = useTranslations('login');

  return (
    <Card className="w-full max-w-sm border-border/60 bg-card/80 shadow-2xl shadow-black/30 backdrop-blur">
      <CardContent className="flex flex-col gap-8 px-8 py-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-black text-white">
            <Crosshair className="size-6" />
          </span>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Evertrust ERP
            </h1>
            <p className="text-sm text-muted-foreground">{t('brand.tagline')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <GoogleSignInButton />
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden />
            {t('form.companyHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

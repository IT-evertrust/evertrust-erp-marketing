'use client';

import { useTranslations } from 'next-intl';
import { Lock, ShieldCheck } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';

// Google-only sign-in surface — ONE designed panel: the brand lockup, the single
// Google action, and the company hint. The email/password form was removed (the API
// disabled POST /auth/login → 403 and only accepts POST /auth/google with a Google ID
// token); all sign-in logic + error handling lives in <GoogleSignInButton>.
export function LoginForm() {
  const t = useTranslations('login');

  return (
    <Card className="w-full max-w-sm border-border/60 bg-card/80 shadow-2xl shadow-black/20 backdrop-blur">
      <CardContent className="flex flex-col items-center gap-7 px-8 py-9">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl border bg-background/60 text-primary shadow-sm">
            <ShieldCheck className="size-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Evertrust ERP
            </h1>
            <p className="text-sm text-muted-foreground">{t('brand.tagline')}</p>
          </div>
        </div>

        <div className="flex w-full flex-col items-center gap-3">
          <GoogleSignInButton />
          <p className="flex items-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden />
            {t('form.companyHint')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';

// Google-only sign-in surface. The email/password form was removed — the backend
// disabled POST /auth/login (403) and now only accepts POST /auth/google with a
// Google ID token. All sign-in logic + error handling lives in <GoogleSignInButton>.
export function LoginForm() {
  const t = useTranslations('login');

  return (
    <Card className="w-full max-w-sm border-border/80 shadow-lg">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">{t('form.title')}</CardTitle>
        <CardDescription>{t('form.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <GoogleSignInButton />
        <p className="text-center text-xs text-muted-foreground">
          {t('form.companyHint')}
        </p>
      </CardContent>
    </Card>
  );
}

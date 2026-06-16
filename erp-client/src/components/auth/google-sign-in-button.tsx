'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { useGoogleLogin } from '@/hooks/use-auth';
import { GOOGLE_CLIENT_ID } from '@/lib/env';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// Maps the API's HTTP status to a translated, human message. The backend already
// returns precise prose (e.g. "Use your company Google account"), but we key off
// the status so the copy stays in our i18n catalog and consistent with the locale.
function messageForError(
  error: unknown,
  t: ReturnType<typeof useTranslations>,
): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 403:
        return t('errors.publicDomain');
      case 401:
        return t('errors.invalidToken');
      case 503:
        return t('errors.notConfigured');
      default:
        // Network error (status 0) or anything unexpected — prefer the API's own
        // message when present, else the generic fallback.
        return error.message || t('errors.generic');
    }
  }
  return t('errors.generic');
}

// Google Identity Services "Sign in with Google" button. Loads the GIS client via
// next/script, renders the official Google button, and on the credential callback
// hands the ID token to /auth/google. This is the ONLY sign-in path (Google-only).
export function GoogleSignInButton() {
  const t = useTranslations('login');
  const login = useGoogleLogin();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // The GIS credential callback runs outside React's event system, so wrap the
  // mutation here. login.mutate is stable across renders (React Query), but we
  // keep it in deps for correctness.
  const handleCredential = useCallback(
    (idToken: string) => {
      login.mutate(idToken, {
        onError: (error) => {
          toast.error(messageForError(error, t));
        },
      });
    },
    [login, t],
  );

  useEffect(() => {
    if (!scriptReady || !GOOGLE_CLIENT_ID) return;
    const gis = window.google?.accounts.id;
    const target = buttonRef.current;
    if (!gis || !target) return;

    gis.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response.credential),
      use_fedcm_for_prompt: true,
    });
    target.replaceChildren();
    gis.renderButton(target, {
      type: 'standard',
      theme: 'filled_black',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: 320,
    });
  }, [scriptReady, handleCredential]);

  // Build-time misconfiguration: no client ID inlined. Show the same "not
  // configured" message the API would 503 with, and skip loading GIS entirely.
  if (!GOOGLE_CLIENT_ID) {
    return (
      <Alert variant="destructive" className="w-full max-w-sm text-left">
        <AlertTitle>{t('errors.notConfiguredTitle')}</AlertTitle>
        <AlertDescription>{t('errors.notConfigured')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Script
        src={GSI_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      {/* GIS renders its own iframe button into this slot once the script is ready.
          The min-height reserves space so the card doesn't jump while it loads. */}
      <div ref={buttonRef} className="min-h-11" aria-busy={!scriptReady} />
      {login.isPending ? (
        <p className="text-sm text-muted-foreground">{t('form.submitting')}</p>
      ) : null}
    </div>
  );
}

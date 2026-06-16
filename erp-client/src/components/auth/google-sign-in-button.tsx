'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ApiError } from '@/lib/api';
import { useGoogleLogin } from '@/hooks/use-auth';
import { GOOGLE_CLIENT_ID } from '@/lib/env';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

// Official multi-colour Google "G", inline so the brand mark renders identically in
// light and dark without an asset request. Sized by the Button's `[&_svg]:size-4`.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.71-1.57 2.69-3.88 2.69-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7a5.41 5.41 0 0 1 0-3.4V4.97H.96a9 9 0 0 0 0 8.06l2.99-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}

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
  const [scriptReady, setScriptReady] = useState(false);
  const initializedRef = useRef(false);

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

  // Initialize GIS once the client script is ready. We deliberately do NOT call
  // renderButton — instead our own <Button> below invokes id.prompt() so the
  // sign-in control matches the design system (no Google-styled iframe). The
  // credential (ID token) still arrives through this callback, so /auth/google is
  // unchanged. FedCM drives the account chooser (use_fedcm_for_prompt).
  useEffect(() => {
    if (!scriptReady || !GOOGLE_CLIENT_ID) return;
    const gis = window.google?.accounts.id;
    if (!gis) return;
    gis.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response.credential),
      use_fedcm_for_prompt: true,
    });
    initializedRef.current = true;
  }, [scriptReady, handleCredential]);

  const startSignIn = useCallback(() => {
    if (!initializedRef.current) return;
    // Opens the FedCM / One Tap account chooser; the selection fires the
    // credential callback wired in initialize().
    window.google?.accounts.id.prompt();
  }, []);

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

  const busy = login.isPending;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Script
        src={GSI_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <Button
        type="button"
        variant="outline"
        onClick={startSignIn}
        disabled={!scriptReady || busy}
        aria-busy={busy}
        className="h-11 w-full gap-3 rounded-xl"
      >
        {busy ? (
          <>
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            />
            {t('form.submitting')}
          </>
        ) : (
          <>
            <GoogleGlyph />
            {t('form.googleCta')}
          </>
        )}
      </Button>
    </div>
  );
}

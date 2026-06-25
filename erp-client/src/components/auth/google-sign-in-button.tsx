'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useGoogleCodeLogin } from '@/hooks/use-auth';
import { GOOGLE_CLIENT_ID } from '@/lib/env';
import { Button } from '@/components/ui/button';
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

// The multi-colour Google "G" glyph as inline SVG (Google's brand mark). Inlined so
// the icon sits inside OUR design-system button instead of Google's un-themeable
// rendered pill — no extra request, no extra dependency.
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5 shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

// "Continue with Google" — a fully custom, on-brand control over the GIS OAuth 2.0
// authorization-code popup flow.
//
// Why not Google's rendered button: it can't be themed (the white "Continue as…"
// pill) and can't be hidden behind a custom button (GIS clickjacking protection
// silently kills clicks on an obscured/transparent button). `oauth2.initCodeClient`
// (ux_mode 'popup') CAN be triggered programmatically from any element, so we own the
// styling. On click we open the consent popup; on success the short-lived auth `code`
// arrives in the callback and we POST it to /auth/google/code, which exchanges it
// server-side (it holds the client SECRET) and sets the auth cookie.
//
// NOTE: the popup only completes on an Authorized JavaScript origin (the Google OAuth
// client). On an unlisted origin (e.g. a random preview port) it errors — add the
// origin in Google Console.
export function GoogleSignInButton() {
  const t = useTranslations('login');
  const login = useGoogleCodeLogin();
  const clientRef = useRef<GoogleCodeClient | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // The GIS callback runs outside React's event system, so wrap the mutation here.
  // login.mutate is stable across renders (React Query), but we keep it in deps for
  // correctness.
  const submit = useCallback(
    (code: string) => {
      login.mutate(code, {
        onError: (error) => {
          toast.error(messageForError(error, t));
        },
      });
    },
    [login, t],
  );

  // Build the code client ONCE per ready+configured state. requestCode() (called on
  // click) opens the consent popup; the callback fires with `code` on success or
  // `error` when the user closes/denies the popup.
  useEffect(() => {
    if (!scriptReady || !GOOGLE_CLIENT_ID) return;
    const oauth2 = window.google?.accounts.oauth2;
    if (!oauth2) return;

    clientRef.current = oauth2.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      ux_mode: 'popup',
      callback: (response) => {
        if (response.code) {
          submit(response.code);
        } else {
          toast.error(messageForError(undefined, t));
        }
      },
    });
  }, [scriptReady, submit, t]);

  const handleClick = useCallback(() => {
    clientRef.current?.requestCode();
  }, []);

  // Build-time misconfiguration: no client ID inlined. Show the same "not
  // configured" message the API would 503 with, and skip loading GIS entirely.
  if (!GOOGLE_CLIENT_ID) {
    return (
      <Alert variant="destructive" className="w-full text-left">
        <AlertTitle>{t('errors.notConfiguredTitle')}</AlertTitle>
        <AlertDescription>{t('errors.notConfigured')}</AlertDescription>
      </Alert>
    );
  }

  // Stay in the "logging you in!" state from the moment the code is exchanged through
  // the redirect into the ERP: isPending covers the /auth/google/code call, and
  // isSuccess covers the brief window until router.replace navigates away and unmounts
  // this button (so it never flickers back to "Continue with Google"). Disabled the
  // whole time so the popup can't be re-triggered.
  const busy = login.isPending || login.isSuccess;
  const disabled = !scriptReady || busy;

  return (
    <>
      <Script
        src={GSI_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={handleClick}
        disabled={disabled}
        aria-busy={busy}
        className="w-full rounded-full border-border/70 bg-card/60 font-medium hover:bg-accent"
      >
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('form.submitting')}
          </>
        ) : (
          <>
            <GoogleGlyph />
            {t('form.googleCta')}
          </>
        )}
      </Button>
    </>
  );
}

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

// Google Identity Services "Continue with Google".
//
// We render Google's OFFICIAL GIS button VISIBLY. An earlier version laid a custom
// design-system button on top and made the real Google button transparent
// (opacity-0) to "own the click" — but GIS's clickjacking protection silently
// refuses to process a click on an obscured/transparent button, so it was dead. The
// GIS button also can't be triggered programmatically (its iframe), and id.prompt()
// / One-Tap is FedCM-cooldown-gated. So the working, supported control is the real
// button, shown as-is. The credential (ID token) arrives via initialize()'s
// callback → /auth/google.
//
// NOTE: GIS only renders on an Authorized JavaScript origin (the Google OAuth
// client). On an unlisted origin (e.g. a random preview port) the button won't
// appear — add the origin in Google Console.
export function GoogleSignInButton() {
  const t = useTranslations('login');
  const login = useGoogleLogin();
  const wrapRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [width, setWidth] = useState(320);

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

  // GIS needs an explicit pixel width (200–400); track the container so the button
  // spans the card.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () =>
      setWidth(Math.min(400, Math.max(200, Math.round(el.offsetWidth))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!scriptReady || !GOOGLE_CLIENT_ID) return;
    const gis = window.google?.accounts.id;
    const target = slotRef.current;
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
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width,
    });
  }, [scriptReady, handleCredential, width]);

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
      {/* GIS renders its real (clickable) button into this centered slot. min-h
          reserves space so the card doesn't jump while the script loads. */}
      <div
        ref={wrapRef}
        aria-busy={!scriptReady}
        className="flex min-h-11 w-full justify-center"
      >
        <div ref={slotRef} />
      </div>
      {login.isPending ? (
        <p className="text-sm text-muted-foreground">{t('form.submitting')}</p>
      ) : null}
    </div>
  );
}

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

// "Sign in with Google". We render Google's OFFICIAL GIS button but make it
// transparent and lay it exactly over our own design-system button: Google's button
// must handle the click itself (its iframe can't be triggered programmatically, and
// id.prompt()/One-Tap is silently suppressed by FedCM cooldowns), so the real,
// working control sits on top — invisibly — while our <Button> below provides the
// look. The credential (ID token) arrives via initialize()'s callback → /auth/google.
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

  // Track the wrapper's width so the (invisible) Google button is rendered at the
  // same width and fully covers our visual button's click target. GIS needs an
  // explicit pixel width (200–400).
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
      logo_alignment: 'center',
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

  const busy = login.isPending;
  return (
    <div className="flex w-full flex-col items-center gap-3">
      <Script
        src={GSI_SRC}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div ref={wrapRef} className="relative w-full">
        {/* Visual control (design system). Decorative only: pointer-events-none +
            aria-hidden so the real Google button overlaid on top owns the click and
            the accessibility semantics. */}
        <Button
          type="button"
          variant="outline"
          tabIndex={-1}
          aria-hidden="true"
          disabled={busy}
          className="pointer-events-none h-11 w-full gap-3 rounded-xl"
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
        {/* The OFFICIAL GIS button — transparent, stretched over the visual button so
            the user's real click lands on it. Hidden from view (opacity-0) and from
            re-clicks while a sign-in is in flight. */}
        <div
          ref={slotRef}
          aria-busy={!scriptReady}
          className={`absolute inset-0 flex items-center justify-center opacity-0 [&_iframe]:!h-full ${
            busy ? 'pointer-events-none' : ''
          }`}
        />
      </div>
    </div>
  );
}

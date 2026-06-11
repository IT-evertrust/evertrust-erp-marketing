import { ShieldCheck } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';

// Data fetching here is fully client-side (the login mutation runs on submit), so
// nothing hits the API at build time. The surface is a centered branded lockup
// over a faint token-based radial wash — restyle only; auth lives in <LoginForm>.
export default function LoginPage() {
  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-background p-4">
      {/* Ambient depth, all token-based (no new colours / CSS): a faint blueprint
          grid masked to the centre + two soft primary glows over the dark base. */}
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

      <div className="relative flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl border bg-card text-foreground shadow-sm">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Evertrust ERP</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Tender operations platform
            </p>
          </div>
        </div>

        <LoginForm />

        <p className="text-xs text-muted-foreground">
          Evertrust GmbH · Authorized access only
        </p>
      </div>
    </main>
  );
}

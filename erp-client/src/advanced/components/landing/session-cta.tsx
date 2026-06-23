'use client';

import Link from 'next/link';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { useMe } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Primary landing CTAs. "Sign in" is always present. We additionally probe the
// session client-side (useMe hits the API at runtime, never at build), and when
// it resolves we surface a "Go to dashboard" shortcut for already-authenticated
// visitors. Keeping this client-side is what lets `/` stay a static route with
// zero network at build time; if the API is unreachable the extra CTA simply
// never appears and the page degrades to "Sign in" only.
export function SessionCta({ className }: { className?: string }) {
  const { data: user } = useMe();

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button
        asChild
        size="lg"
        className="group h-11 bg-amber-400 px-6 text-neutral-950 hover:bg-amber-300"
      >
        <Link href="/login">
          Sign in
          <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </Button>

      {user ? (
        <Button
          asChild
          size="lg"
          variant="outline"
          className="h-11 border-white/15 bg-white/5 px-6 text-neutral-100 hover:bg-white/10 hover:text-white"
        >
          <Link href="/dashboard">
            <LayoutDashboard />
            Go to dashboard
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

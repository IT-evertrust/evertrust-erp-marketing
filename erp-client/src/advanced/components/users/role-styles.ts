import type { UserRole } from '@evertrust/shared';

// Per-role visual language, shared by the role tiles + the team table so the
// colour coding (authority: warm = high → neutral = low) stays consistent.
//  - dot:   a solid swatch for accent bars + status dots
//  - tint:  subtle bg+text for avatars / chips
//  - blurb: one-line "what this role can do" (doubles as the access legend)
export const ROLE_STYLES: Record<
  UserRole,
  { dot: string; tint: string; gradient: string; blurb: string }
> = {
  OWNER: {
    dot: 'bg-amber-400',
    tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    gradient: 'from-amber-400 to-rose-400',
    blurb: 'Platform owner — manages users across all organizations.',
  },
  SUPER_ADMIN: {
    dot: 'bg-violet-400',
    tint: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    gradient: 'from-violet-400 to-sky-400',
    blurb: 'Full control — including user management.',
  },
  ADMIN: {
    dot: 'bg-sky-400',
    tint: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    gradient: 'from-sky-400 to-violet-400',
    blurb: 'Everything except managing users.',
  },
  MANAGER: {
    dot: 'bg-emerald-400',
    tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    gradient: 'from-emerald-400 to-sky-400',
    blurb: 'Tenders, pricing & approvals, campaigns.',
  },
  EMPLOYEE: {
    dot: 'bg-zinc-400',
    tint: 'bg-muted text-muted-foreground',
    gradient: 'from-zinc-400 to-zinc-500',
    blurb: 'Day-to-day operations — read + tender work.',
  },
};

// Authority order, highest → lowest, for the tiles.
export const ROLE_ORDER: UserRole[] = [
  'OWNER',
  'SUPER_ADMIN',
  'ADMIN',
  'MANAGER',
  'EMPLOYEE',
];

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Building2, LogOut, Settings, UserRound } from 'lucide-react';
import { DEPARTMENT_LABELS, ROLE_LABELS, type MeDto } from '@evertrust/shared';
import { useLogout } from '@/hooks/use-auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

export function UserMenu({ user }: { user: MeDto }) {
  const logout = useLogout();
  const t = useTranslations('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="flex items-center gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="text-xs">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
          <Badge variant="outline" className="hidden font-normal sm:inline-flex">
            {ROLE_LABELS[user.role]}
          </Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <Building2 className="size-3.5 shrink-0" />
            {/* Real org name from the M1 /auth/me join. organizationName is
                optional in MeDto (pre-M1 deployments omit it), so fall back to a
                neutral label rather than rendering "undefined". */}
            <span className="truncate">{user.organizationName ?? 'Organization'}</span>
            <Badge variant="secondary" className="ml-auto font-normal">
              {/* role + department where available, e.g. "Manager · IT" */}
              {user.department
                ? `${ROLE_LABELS[user.role]} · ${DEPARTMENT_LABELS[user.department]}`
                : ROLE_LABELS[user.role]}
            </Badge>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings/general">
              <Settings />
              {t('settings')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/users/${user.id}`}>
              <UserRound />
              {t('profile')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={logout.isPending}
            onSelect={(event) => {
              event.preventDefault();
              logout.mutate();
            }}
          >
            <LogOut />
            {t('logOut')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

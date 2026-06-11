'use client';

import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useLogout } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';

type LogoutButtonProps = {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  children?: ReactNode;
  showIcon?: boolean;
};

// Self-contained, always-functional logout: clears the session cookie via the Next
// /api/logout route, drops cached user state, and returns to /login. Safe to use
// anywhere — including the stranded "session invalid" state where no user is loaded.
export function LogoutButton({
  variant = 'outline',
  size = 'default',
  className,
  children = 'Sign out',
  showIcon = true,
}: LogoutButtonProps) {
  const logout = useLogout();
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={logout.isPending}
      onClick={() => logout.mutate()}
    >
      {showIcon ? <LogOut /> : null}
      {logout.isPending ? 'Signing out…' : children}
    </Button>
  );
}

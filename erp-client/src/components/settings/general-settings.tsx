'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, LogOut } from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  POSITION_LABELS,
  ROLE_LABELS,
} from '@evertrust/shared';
import { useLogout, useMe, useUpdateMyName } from '@/hooks/use-auth';
import { PageHeader } from '@/components/common/page-header';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

// Initials for the avatar fallback — same rule as the topbar user menu so a user's
// monogram is consistent across the shell. "Ada Lovelace" → "AL", single name →
// first two letters, empty → "?".
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// A muted-label / foreground-value row used for the read-only profile fields.
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

// General settings: the signed-in user's own profile + account. Open to every
// authenticated user (no permission gate). The only editable field is the display
// name (PATCH /users/me); everything else is read-only and managed elsewhere.
export function GeneralSettings() {
  const me = useMe();
  const updateName = useUpdateMyName();
  const logout = useLogout();

  const savedName = me.data?.name ?? '';
  const [name, setName] = useState('');

  // Seed/refresh the input from the canonical value once the user loads (and after
  // a successful save, since the mutation writes the fresh row back into the cache).
  useEffect(() => {
    setName(savedName);
  }, [savedName]);

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty.');
      return;
    }
    updateName.mutate(
      { name: trimmed },
      {
        onSuccess: () => toast.success('Name updated.'),
        onError: (e) => toast.error(e.message ?? 'Could not save your name.'),
      },
    );
  }

  if (me.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="General" description="Your profile and account." />
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  const user = me.data;
  if (!user) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="General" description="Your profile and account." />
        <p className="text-sm text-muted-foreground">
          Could not load your profile.
        </p>
      </div>
    );
  }

  // Unchanged when the trimmed input still equals the saved name (empty edits are
  // blocked at save time too).
  const dirty = name.trim() !== savedName && name.trim().length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="General" description="Your profile and account." />

      {/* Profile: monogram + editable name, then read-only identity fields. */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Avatar className="size-16 shrink-0">
            <AvatarFallback className="border border-violet-500/30 bg-violet-500/10 text-lg font-medium text-violet-400">
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name" className="text-xs text-muted-foreground">
                Display name
              </Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="max-w-xs"
                  autoComplete="name"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={save}
                  disabled={updateName.isPending || !dirty}
                >
                  {updateName.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              <InfoRow label="Email">{user.email}</InfoRow>
              <InfoRow label="Role">
                <Badge variant="outline" className="font-normal">
                  {ROLE_LABELS[user.role]}
                </Badge>
              </InfoRow>
              <InfoRow label="Department">
                {user.department ? DEPARTMENT_LABELS[user.department] : '—'}
              </InfoRow>
              <InfoRow label="Title">
                {user.position ? POSITION_LABELS[user.position] : '—'}
              </InfoRow>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Organization: read-only — org membership is administered, not self-served. */}
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Building2 className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {user.organizationName ?? 'Organization'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Managed by your administrator.
          </p>
        </CardContent>
      </Card>

      {/* Account: who you're signed in as + a self-service log out. */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm">
              Signed in as{' '}
              <span className="font-medium">{user.email}</span>
            </span>
            <Badge variant="outline" className="font-normal">
              {ROLE_LABELS[user.role]}
            </Badge>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

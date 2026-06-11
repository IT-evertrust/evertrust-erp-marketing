'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound } from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  PERMISSIONS,
  POSITION_LABELS,
  ROLE_LABELS,
  effectivePermissions,
} from '@evertrust/shared';
import {
  useAdminUsers,
  useSetPassword,
  useUserStats,
} from '@/hooks/use-admin-users';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/common/stat-tile';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { ROLE_STYLES } from './role-styles';
import { UserEditDialog } from './user-edit-dialog';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// Group permissions by resource (the part before ':') for the access list.
function groupPermissions(perms: readonly string[]): [string, string[]][] {
  const map = new Map<string, string[]>();
  for (const p of perms) {
    const [resource, action] = p.split(':');
    const arr = map.get(resource!) ?? [];
    arr.push(action ?? resource!);
    map.set(resource!, arr);
  }
  return Array.from(map.entries());
}

// Profile page (/users/[id]). Reached by clicking a member in the Users
// directory. No single-user API endpoint exists, so we read the org directory
// and select by id. Every field shown is REAL (identity, role, department,
// position, status, joined, effective permissions). Contribution metrics +
// activity history aren't tracked per-user yet — we say so rather than invent.
export function ProfileView({ userId }: { userId: string }) {
  const users = useAdminUsers();
  const stats = useUserStats(userId);
  const setPw = useSetPassword();
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');

  if (users.isLoading) {
    return <Skeleton className="h-96 w-full rounded-lg" />;
  }
  if (users.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not load this profile: {users.error.message}
      </p>
    );
  }

  const user = users.data?.find((u) => u.id === userId);
  if (!user) {
    return (
      <div className="flex flex-col gap-3">
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href="/users">
            <ArrowLeft className="mr-1 size-3.5" /> Users
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          User not found. They may have been removed, or this is a stale link.
        </p>
      </div>
    );
  }

  const styles = ROLE_STYLES[user.role];
  const perms = effectivePermissions(user.role, user.permissions);
  const grouped = groupPermissions(perms);
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Users
      </Link>

      {/* header card */}
      <Card className="overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-amber-500/30 via-violet-500/20 to-sky-500/20" />
        <CardContent className="pt-0">
          <div className="-mt-8 flex flex-wrap items-end gap-4">
            <Avatar className="size-20 rounded-2xl border-4 border-background">
              <AvatarFallback
                className={cn('rounded-2xl text-2xl font-semibold', styles.tint)}
              >
                {initials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold">{user.name}</h1>
                <Badge
                  className={cn(
                    'gap-1.5 border-transparent font-medium',
                    styles.tint,
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', styles.dot)} />
                  {ROLE_LABELS[user.role]}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  user.position ? POSITION_LABELS[user.position] : null,
                  user.department ? DEPARTMENT_LABELS[user.department] : null,
                  user.email,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5',
                    user.active && 'text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      user.active ? 'bg-emerald-500' : 'bg-muted-foreground',
                    )}
                  />
                  {user.active ? 'Active' : 'Inactive'}
                </span>
                <span>Member since {formatDateTime(user.createdAt)}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-1"
              onClick={() => setEditOpen(true)}
            >
              Edit profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* contribution tiles — REAL per-user data (campaigns deployed, stages
          triggered, audited actions) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Campaigns launched"
          value={stats.data ? stats.data.campaignsLaunched : '—'}
          accent="bg-sky-400"
        />
        <StatTile
          label="Stages run"
          value={stats.data ? stats.data.stagesRun : '—'}
          accent="bg-violet-400"
        />
        <StatTile
          label="Actions logged"
          value={stats.data ? stats.data.actionsLogged : '—'}
          accent="bg-emerald-400"
        />
        <StatTile
          label="Permissions"
          value={`${perms.length} / ${PERMISSIONS.length}`}
          hint="granted"
        />
      </div>

      <Tabs defaultValue="access">
        <TabsList>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* Access */}
        <TabsContent value="access" className="mt-4">
          <Card>
            <CardContent className="flex flex-col gap-5 pt-6">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Role &amp; placement
                </p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">Role</dt>
                    <dd className="font-medium">
                      {ROLE_LABELS[user.role]}
                      {isSuperAdmin ? (
                        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                          🔒 locked
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Department</dt>
                    <dd className="font-medium">
                      {user.department
                        ? DEPARTMENT_LABELS[user.department]
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Position</dt>
                    <dd className="font-medium">
                      {user.position ? POSITION_LABELS[user.position] : '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Effective permissions ({perms.length})
                  </p>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                  >
                    <Link href="/users">Edit access</Link>
                  </Button>
                </div>
                <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                  {grouped.map(([resource, actions]) => (
                    <div
                      key={resource}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
                    >
                      <span className="w-24 shrink-0 font-medium capitalize">
                        {resource}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {actions.map((a) => (
                          <Badge
                            key={a}
                            variant="secondary"
                            className="px-1.5 py-0 text-[10px] font-normal"
                          >
                            {a}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Account */}
        <TabsContent value="account" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Account
              </p>
              <div className="flex flex-col divide-y">
                <AccountRow k="Email" v={user.email} />
                <AccountRow k="Phone" v={user.phone ?? '—'} />
                <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">Password</span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium tracking-widest">••••••••</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewPw('');
                        setPwOpen(true);
                      }}
                    >
                      <KeyRound className="mr-1 size-3.5" /> Change
                    </Button>
                  </div>
                </div>
                <AccountRow k="Status" v={user.active ? 'Active' : 'Inactive'} />
                <AccountRow k="Role" v={ROLE_LABELS[user.role]} />
                <AccountRow
                  k="Member since"
                  v={formatDateTime(user.createdAt)}
                />
                <AccountRow k="User ID" v={user.id} mono />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Changing the password sets a new one immediately — there&apos;s no
                email reset flow, so share it securely.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity — real, from the audit log */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              {stats.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : !stats.data || stats.data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No recorded activity yet.
                </p>
              ) : (
                <div className="flex flex-col divide-y">
                  {stats.data.recentActivity.map((a, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-4 py-2.5 text-sm"
                    >
                      <span>
                        <span className="font-medium capitalize">
                          {a.action.toLowerCase()}
                        </span>{' '}
                        <span className="text-muted-foreground">· {a.entity}</span>
                      </span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDateTime(a.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <UserEditDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      {/* admin password reset */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set a new password</DialogTitle>
            <DialogDescription>
              {user.name} · {user.email}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPw}
              placeholder="At least 8 characters"
              onChange={(e) => setNewPw(e.target.value)}
            />
            {newPw && newPw.length < 8 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Use at least 8 characters.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPwOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={newPw.length < 8 || setPw.isPending}
              onClick={() =>
                setPw.mutate(
                  { id: user.id, password: newPw },
                  {
                    onSuccess: () => {
                      toast.success(`Password updated for ${user.name}.`);
                      setPwOpen(false);
                    },
                    onError: (e) =>
                      toast.error(e.message ?? 'Could not set the password.'),
                  },
                )
              }
            >
              {setPw.isPending ? 'Saving…' : 'Set password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountRow({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn('font-medium', mono && 'font-mono text-xs')}>{v}</span>
    </div>
  );
}

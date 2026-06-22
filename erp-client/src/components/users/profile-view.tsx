'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound } from 'lucide-react';
import {
  PERMISSIONS,
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
import { StatTile } from '@/components/rean/stat-tile';
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
  const t = useTranslations('users');
  const users = useAdminUsers();
  const stats = useUserStats(userId);
  const setPw = useSetPassword();
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');

  if (users.isLoading) {
    return (
      <main className="px-6 py-5">
        <Skeleton className="h-96 w-full rounded-[10px]" />
      </main>
    );
  }
  if (users.isError) {
    return (
      <main className="px-6 py-5">
        <p className="text-sm text-destructive">
          {t('profile.loadError', { message: users.error.message })}
        </p>
      </main>
    );
  }

  const user = users.data?.find((u) => u.id === userId);
  if (!user) {
    return (
      <main className="flex flex-col gap-3 px-6 py-5">
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href="/users">
            <ArrowLeft className="mr-1 size-3.5" /> {t('profile.back')}
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          {t('profile.notFound')}
        </p>
      </main>
    );
  }

  const styles = ROLE_STYLES[user.role];
  const perms = effectivePermissions(user.role, user.permissions);
  const grouped = groupPermissions(perms);
  const isSuperAdmin = user.role === 'SUPER_ADMIN';

  return (
    <main className="flex flex-col gap-6 px-6 py-5 duration-300 animate-in fade-in">
      <Link
        href="/users"
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {t('profile.back')}
      </Link>

      {/* header card */}
      <div className="overflow-hidden rounded-[10px] border border-sidebar-border bg-card">
        <div className="h-20 bg-gradient-to-r from-emerald-500/30 via-sky-500/20 to-violet-500/20" />
        <div className="px-6 pb-6 pt-0">
          <div className="-mt-8 flex flex-wrap items-end gap-4">
            <Avatar className="size-20 rounded-2xl border-4 border-background">
              <AvatarFallback
                className={cn(
                  'rounded-2xl bg-gradient-to-br text-2xl font-semibold text-white',
                  styles.gradient,
                )}
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
                  {t(`role.${user.role}`)}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {[
                  user.position ? t(`position.${user.position}`) : null,
                  user.department ? t(`department.${user.department}`) : null,
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
                  {user.active ? t('profile.active') : t('profile.inactive')}
                </span>
                <span>{t('profile.memberSince', { date: formatDateTime(user.createdAt) })}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mb-1"
              onClick={() => setEditOpen(true)}
            >
              {t('profile.editProfile')}
            </Button>
          </div>
        </div>
      </div>

      {/* contribution tiles — REAL per-user data (campaigns deployed, stages
          triggered, audited actions) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('profile.tiles.campaignsLaunched')}
          value={stats.data ? stats.data.campaignsLaunched : '—'}
          accent="sky"
        />
        <StatTile
          label={t('profile.tiles.stagesRun')}
          value={stats.data ? stats.data.stagesRun : '—'}
          accent="violet"
        />
        <StatTile
          label={t('profile.tiles.actionsLogged')}
          value={stats.data ? stats.data.actionsLogged : '—'}
          accent="emerald"
        />
        <StatTile
          label={t('profile.tiles.permissions')}
          value={`${perms.length} / ${PERMISSIONS.length}`}
          accent="amber"
          hint={t('profile.tiles.granted')}
        />
      </div>

      <Tabs defaultValue="access">
        <TabsList className="h-auto w-fit rounded-[10px] border border-sidebar-border bg-card p-1">
          {(['access', 'account', 'activity'] as const).map((v) => (
            <TabsTrigger
              key={v}
              value={v}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground',
                'data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-600 data-[state=active]:shadow-none',
                'dark:data-[state=active]:bg-emerald-500/10 dark:data-[state=active]:text-emerald-400 dark:data-[state=active]:border-transparent',
              )}
            >
              {t(`profile.tabs.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Access */}
        <TabsContent value="access" className="mt-4">
          <div className="rounded-[10px] border border-sidebar-border bg-card p-5">
            <div className="flex flex-col gap-5">
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('profile.rolePlacement')}
                </p>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('profile.role')}</dt>
                    <dd className="font-medium">
                      {t(`role.${user.role}`)}
                      {isSuperAdmin ? (
                        <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                          {t('profile.locked')}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('profile.department')}</dt>
                    <dd className="font-medium">
                      {user.department
                        ? t(`department.${user.department}`)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('profile.position')}</dt>
                    <dd className="font-medium">
                      {user.position ? t(`position.${user.position}`) : '—'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    {t('profile.effectivePermissions', { count: perms.length })}
                  </p>
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                  >
                    <Link href="/users">{t('profile.editAccess')}</Link>
                  </Button>
                </div>
                <div className="flex flex-col gap-2 rounded-[10px] border border-sidebar-border bg-muted/30 p-3">
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
            </div>
          </div>
        </TabsContent>

        {/* Account */}
        <TabsContent value="account" className="mt-4">
          <div className="rounded-[10px] border border-sidebar-border bg-card p-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {t('profile.account')}
              </p>
              <div className="flex flex-col divide-y divide-sidebar-border">
                <AccountRow k={t('profile.accountRow.email')} v={user.email} />
                <AccountRow k={t('profile.accountRow.phone')} v={user.phone ?? '—'} />
                <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">{t('profile.accountRow.password')}</span>
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
                      <KeyRound className="mr-1 size-3.5" /> {t('profile.change')}
                    </Button>
                  </div>
                </div>
                <AccountRow k={t('profile.accountRow.status')} v={user.active ? t('profile.active') : t('profile.inactive')} />
                <AccountRow k={t('profile.accountRow.role')} v={t(`role.${user.role}`)} />
                <AccountRow
                  k={t('profile.accountRow.memberSince')}
                  v={formatDateTime(user.createdAt)}
                />
                <AccountRow k={t('profile.accountRow.userId')} v={user.id} mono />
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                {t('profile.passwordNote')}
              </p>
          </div>
        </TabsContent>

        {/* Activity — real, from the audit log */}
        <TabsContent value="activity" className="mt-4">
          <div className="rounded-[10px] border border-sidebar-border bg-card p-5">
              {stats.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : !stats.data || stats.data.recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('profile.noActivity')}
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-sidebar-border">
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
          </div>
        </TabsContent>
      </Tabs>

      <UserEditDialog user={user} open={editOpen} onOpenChange={setEditOpen} />

      {/* admin password reset */}
      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('profile.passwordDialog.title')}</DialogTitle>
            <DialogDescription>
              {user.name} · {user.email}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-pw">{t('profile.passwordDialog.newPassword')}</Label>
            <Input
              id="new-pw"
              type="password"
              value={newPw}
              placeholder={t('profile.passwordDialog.placeholder')}
              onChange={(e) => setNewPw(e.target.value)}
            />
            {newPw && newPw.length < 8 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('profile.passwordDialog.hint')}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setPwOpen(false)}>
              {t('profile.passwordDialog.cancel')}
            </Button>
            <Button
              type="button"
              disabled={newPw.length < 8 || setPw.isPending}
              onClick={() =>
                setPw.mutate(
                  { id: user.id, password: newPw },
                  {
                    onSuccess: () => {
                      toast.success(t('profile.passwordDialog.updatedToast', { name: user.name }));
                      setPwOpen(false);
                    },
                    onError: (e) =>
                      toast.error(e.message ?? t('profile.passwordDialog.error')),
                  },
                )
              }
            >
              {setPw.isPending ? t('profile.passwordDialog.saving') : t('profile.passwordDialog.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
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

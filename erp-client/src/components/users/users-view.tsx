'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  Eye,
  KeyRound,
  Lock,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  effectivePermissions,
  type AdminUserDto,
  type Department,
  type UserRole,
} from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import {
  useAdminUsers,
  useUpdateUser,
} from '@/hooks/use-admin-users';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UserCreateDialog } from '@/components/users/user-create-dialog';
import { EditUserDialog } from '@/components/users/edit-user-dialog';
import { UserDetailsDialog } from '@/components/users/user-details-dialog';
import { DeleteUserDialog } from '@/components/users/delete-user-dialog';
import { cn } from '@/lib/utils';

const ROLE_PILL: Record<UserRole, string> = {
  SUPER_ADMIN: 'border-violet-500/30 bg-violet-500/10 text-violet-500',
  ADMIN: 'border-sky-500/30 bg-sky-500/10 text-sky-500',
  MANAGER: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
  EMPLOYEE: 'border-border bg-muted text-muted-foreground',
};
const ROLE_AV: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-violet-500/15 text-violet-300',
  ADMIN: 'bg-sky-500/15 text-sky-300',
  MANAGER: 'bg-amber-500/15 text-amber-300',
  EMPLOYEE: 'bg-muted text-muted-foreground',
};
const DEPTS = Object.keys(DEPARTMENT_LABELS) as Department[];
const NO_DEPT = '__none__';

const initials = (n: string) =>
  n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const joined = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const permCount = (u: AdminUserDto) =>
  effectivePermissions(u.role, u.permissions ?? null).length;

type StatusFilter = 'all' | 'active' | 'inactive';
type Layout = 'flat' | 'grouped';

export function UsersView() {
  const t = useTranslations('users');
  const usersQ = useAdminUsers();
  const me = useMe();
  const [q, setQ] = useState('');
  const [roleF, setRoleF] = useState<'all' | UserRole>('all');
  const [deptF, setDeptF] = useState<'all' | Department>('all');
  const [statusF, setStatusF] = useState<StatusFilter>('all');
  const [layout, setLayout] = useState<Layout>('flat');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<AdminUserDto | null>(null);
  const [detailUser, setDetailUser] = useState<AdminUserDto | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUserDto | null>(null);

  const all = usersQ.data ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((u) => {
      if (needle && !(u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))) return false;
      if (roleF !== 'all' && u.role !== roleF) return false;
      if (deptF !== 'all' && u.department !== deptF) return false;
      if (statusF === 'active' && !u.active) return false;
      if (statusF === 'inactive' && u.active) return false;
      return true;
    });
  }, [all, q, roleF, deptF, statusF]);

  const activeCount = all.filter((u) => u.active).length;
  const adminCount = all.filter((u) => u.role === 'SUPER_ADMIN' || u.role === 'ADMIN').length;
  const deptCount = new Set(all.map((u) => u.department).filter(Boolean)).size;
  const cols = layout === 'flat' ? 8 : 7;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border bg-card p-0.5">
              {(['flat', 'grouped'] as const).map((l) => (
                <button
                  key={l}
                  onClick={() => setLayout(l)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    layout === l ? 'bg-muted text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {l === 'flat' ? t('layout.flat') : t('layout.grouped')}
                </button>
              ))}
            </div>
            <Button onClick={() => setShowCreate(true)}>
              <UserPlus className="size-4" />
              {t('addMember')}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['members', all.length],
          ['active', activeCount],
          ['admins', adminCount],
          ['departments', deptCount],
        ] as [string, number][]).map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card px-4 py-3">
            <div className="text-xl font-bold tabular-nums">
              {usersQ.isLoading ? <Skeleton className="h-6 w-8" /> : v}
            </div>
            <div className="mt-0.5 text-[10.5px] uppercase tracking-wide text-muted-foreground/70">{t(`stats.${k}`)}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="h-9 max-w-xs"
        />
        <select
          value={roleF}
          onChange={(e) => setRoleF(e.target.value as 'all' | UserRole)}
          className="h-9 rounded-md border bg-card px-2 text-sm"
        >
          <option value="all">{t('allRoles')}</option>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
            <option key={r} value={r}>{t(`role.${r}`)}</option>
          ))}
        </select>
        {layout === 'flat' ? (
          <select
            value={deptF}
            onChange={(e) => setDeptF(e.target.value as 'all' | Department)}
            className="h-9 rounded-md border bg-card px-2 text-sm"
          >
            <option value="all">{t('allDepartments')}</option>
            {DEPTS.map((d) => (
              <option key={d} value={d}>{t(`department.${d}`)}</option>
            ))}
          </select>
        ) : null}
        <div className="inline-flex overflow-hidden rounded-md border">
          {(['all', 'active', 'inactive'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusF(s)}
              className={cn('h-9 px-3 text-xs capitalize', statusF === s ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            >
              {t(`statusFilter.${s}`)}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('countSummary', { filtered: filtered.length, total: all.length })}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {usersQ.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : usersQ.isError ? (
          <p className="p-6 text-sm text-destructive">{t('loadError', { message: usersQ.error.message })}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.member')}</TableHead>
                <TableHead>{t('table.role')}</TableHead>
                {layout === 'flat' ? <TableHead>{t('table.department')}</TableHead> : null}
                <TableHead>{t('table.position')}</TableHead>
                <TableHead>{t('table.access')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead>{t('table.joined')}</TableHead>
                <TableHead className="text-right">{t('table.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={cols} className="py-10 text-center text-sm text-muted-foreground">
                    {t('noMembers')}
                  </TableCell>
                </TableRow>
              ) : layout === 'flat' ? (
                filtered.map((u) => (
                  <UserRowCells
                    key={u.id}
                    u={u}
                    showDept
                    selfId={me.data?.id}
                    onDetails={() => setDetailUser(u)}
                    onEdit={() => setEditUser(u)}
                    onDelete={() => setDeleteUser(u)}
                  />
                ))
              ) : (
                [...DEPTS, NO_DEPT as unknown as Department].flatMap((dept) => {
                  const isNone = (dept as unknown as string) === NO_DEPT;
                  const members = filtered.filter((u) => (isNone ? !u.department : u.department === dept));
                  if (!members.length) return [];
                  const label = isNone ? t('noDepartment') : t(`department.${dept}`);
                  const isCol = collapsed.has(label);
                  return [
                    <TableRow
                      key={`g-${label}`}
                      className="cursor-pointer bg-muted/40 hover:bg-muted/50"
                      onClick={() =>
                        setCollapsed((p) => {
                          const n = new Set(p);
                          if (n.has(label)) n.delete(label);
                          else n.add(label);
                          return n;
                        })
                      }
                    >
                      <TableCell colSpan={cols} className="py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <ChevronDown className={cn('mr-1.5 inline size-3.5 transition-transform', isCol && '-rotate-90')} />
                        {label}
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-foreground">{members.length}</span>
                      </TableCell>
                    </TableRow>,
                    ...(isCol
                      ? []
                      : members.map((u) => (
                          <UserRowCells
                            key={u.id}
                            u={u}
                            showDept={false}
                            selfId={me.data?.id}
                            onDetails={() => setDetailUser(u)}
                            onEdit={() => setEditUser(u)}
                            onDelete={() => setDeleteUser(u)}
                          />
                        ))),
                  ];
                })
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <UserCreateDialog open={showCreate} onOpenChange={setShowCreate} />
      {editUser ? (
        <EditUserDialog user={editUser} selfId={me.data?.id} open onOpenChange={(o) => !o && setEditUser(null)} />
      ) : null}
      {detailUser ? (
        <UserDetailsDialog user={detailUser} open onOpenChange={(o) => !o && setDetailUser(null)} />
      ) : null}
      {deleteUser ? (
        <DeleteUserDialog user={deleteUser} open onOpenChange={(o) => !o && setDeleteUser(null)} />
      ) : null}
    </div>
  );
}

function UserRowCells({
  u,
  showDept,
  selfId,
  onDetails,
  onEdit,
  onDelete,
}: {
  u: AdminUserDto;
  showDept: boolean;
  selfId?: string;
  onDetails: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('users');
  const update = useUpdateUser();
  const isSA = u.role === 'SUPER_ADMIN';
  const isSelf = u.id === selfId;
  const protectedRow = isSA || isSelf;
  const total = PERMISSIONS.length;

  const toggleActive = () => {
    if (protectedRow || update.isPending) return;
    update.mutate(
      { id: u.id, patch: { active: !u.active } },
      {
        onSuccess: () =>
          toast.success(
            t(u.active ? 'toast.deactivated' : 'toast.reactivated', { name: u.name }),
          ),
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <TableRow className={cn(!u.active && 'opacity-60')}>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className={cn('text-xs font-semibold', ROLE_AV[u.role])}>{initials(u.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{u.name}</div>
            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold', ROLE_PILL[u.role])}>
          {t(`role.${u.role}`)}
        </span>
      </TableCell>
      {showDept ? (
        <TableCell className="text-[13px]">
          {u.department ? t(`department.${u.department}`) : <span className="text-muted-foreground">—</span>}
        </TableCell>
      ) : null}
      <TableCell className="text-[13px]">
        {u.position ? t(`position.${u.position}`) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        {isSA ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-500">
            <ShieldCheck className="size-3.5" /> {t('fullAccess')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <KeyRound className="size-3" />
            {t.rich('permsCount', {
              count: permCount(u),
              total,
              b: (chunks) => <b className="text-foreground">{chunks}</b>,
            })}
          </span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            role="switch"
            aria-checked={u.active}
            onClick={toggleActive}
            disabled={protectedRow || update.isPending}
            title={
              protectedRow
                ? isSA
                  ? t('toggle.protectedSuperAdmin')
                  : t('toggle.protectedSelf')
                : u.active
                  ? t('toggle.deactivate')
                  : t('toggle.reactivate')
            }
            aria-label={u.active ? t('toggle.ariaDeactivate') : t('toggle.ariaReactivate')}
            className={cn(
              'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
              u.active ? 'bg-emerald-500' : 'bg-muted ring-1 ring-inset ring-border',
              protectedRow ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
            )}
          >
            <span
              className={cn(
                'inline-block size-4 rounded-full shadow transition-transform',
                u.active ? 'translate-x-4 bg-white' : 'translate-x-0.5 bg-zinc-300',
              )}
            />
          </button>
          <span className={cn('text-[12.5px]', !u.active && 'text-muted-foreground')}>
            {u.active ? t('status.active') : t('status.deactivated')}
          </span>
          {isSA ? <Lock className="size-3 text-muted-foreground" /> : null}
        </div>
      </TableCell>
      <TableCell className="text-[12.5px] text-muted-foreground">{joined(u.createdAt)}</TableCell>
      <TableCell className="text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={onDetails}>
              <Eye className="size-4" /> {t('menu.viewDetails')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" /> {t('menu.editAccess')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {protectedRow ? (
              <DropdownMenuItem disabled>
                <Lock className="size-4" /> {isSA ? t('menu.protectedSuperAdmin') : t('menu.protectedSelf')}
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onClick={toggleActive}>
                  {u.active ? t('menu.deactivate') : t('menu.reactivate')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
                  <Trash2 className="size-4" /> {t('menu.delete')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

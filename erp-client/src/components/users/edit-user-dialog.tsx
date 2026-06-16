'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  POSITION_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  permissionsForRole,
  effectivePermissions,
  type AdminUserDto,
  type Department,
  type Permission,
  type Position,
  type UserRole,
} from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useUpdateUser } from '@/hooks/use-admin-users';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Permission catalog grouped by resource (the part before ':').
const GROUPS: [string, Permission[]][] = (() => {
  const m: Record<string, Permission[]> = {};
  for (const p of PERMISSIONS) {
    const r = p.split(':')[0]!;
    (m[r] ||= []).push(p);
  }
  return Object.entries(m);
})();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function EditUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserDto;
  selfId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('users');
  const { data: me } = useMe();
  const update = useUpdateUser();
  const isSA = user.role === 'SUPER_ADMIN';
  // OWNER & SUPER_ADMIN both hold every permission (see ROLE_PERMISSIONS), so
  // both render as "full access" with the permission grid frozen.
  const fullAccess = user.role === 'OWNER' || isSA;
  // Mirror the API: only an Owner can grant OWNER; SUPER_ADMIN needs Owner or
  // Super Admin. And an Owner target is locked for any non-Owner viewer.
  const canGrantOwner = me?.role === 'OWNER';
  const canGrantSuperAdmin = me?.role === 'OWNER' || me?.role === 'SUPER_ADMIN';
  const ownerLocked = user.role === 'OWNER' && me?.role !== 'OWNER';
  const roleLocked = isSA || ownerLocked;
  const roleOptions = (Object.keys(ROLE_LABELS) as UserRole[]).filter((r) => {
    if (r === 'OWNER') return canGrantOwner;
    if (r === 'SUPER_ADMIN') return canGrantSuperAdmin;
    return true;
  });
  const [role, setRole] = useState<UserRole>(user.role);
  const [position, setPosition] = useState<Position | ''>(user.position ?? '');
  const [department, setDepartment] = useState<Department | ''>(user.department ?? '');
  const [perms, setPerms] = useState<Set<Permission>>(
    new Set(effectivePermissions(user.role, user.permissions ?? null)),
  );

  const toggle = (p: Permission) =>
    setPerms((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  const resetDefaults = () => setPerms(new Set(permissionsForRole(role)));

  const save = () => {
    const def = permissionsForRole(role);
    const sameAsRole = perms.size === def.length && def.every((p) => perms.has(p));
    update.mutate(
      {
        id: user.id,
        patch: {
          role,
          position: position || null,
          department: department || null,
          // OWNER/SUPER_ADMIN perms are ignored server-side; otherwise null = follow role default.
          ...(fullAccess ? {} : { permissions: sameAsRole ? null : [...perms] }),
        },
      },
      {
        onSuccess: () => {
          toast.success(t('editAccess.savedToast'));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] overflow-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('editAccess.title', { name: user.name })}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('editAccess.role')}
            <select
              disabled={roleLocked}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground disabled:opacity-60"
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>{t(`role.${r}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('editAccess.position')}
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position | '')}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"
            >
              <option value="">{t('editAccess.none')}</option>
              {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
                <option key={p} value={p}>{t(`position.${p}`)}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground">
            {t('editAccess.department')}
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department | '')}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"
            >
              <option value="">{t('editAccess.none')}</option>
              {(Object.keys(DEPARTMENT_LABELS) as Department[]).map((d) => (
                <option key={d} value={d}>{t(`department.${d}`)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {fullAccess
              ? t('editAccess.permsFullAccess', { role: ROLE_LABELS[user.role] })
              : t('editAccess.permsEffective')}
          </p>
          {!fullAccess ? (
            <Button variant="ghost" size="sm" onClick={resetDefaults}>
              <RotateCcw className="size-3.5" /> {t('editAccess.resetDefaults')}
            </Button>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {GROUPS.map(([res, list]) => (
            <div key={res} className="rounded-lg border p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold">{cap(res)}</div>
              {list.map((p) => (
                <label
                  key={p}
                  className="flex items-center gap-2 py-0.5 font-mono text-[11.5px] text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    checked={fullAccess || perms.has(p)}
                    disabled={fullAccess}
                    onChange={() => toggle(p)}
                    className="accent-violet-500"
                  />
                  <span>{p}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('editAccess.cancel')}</Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? t('editAccess.saving') : t('editAccess.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

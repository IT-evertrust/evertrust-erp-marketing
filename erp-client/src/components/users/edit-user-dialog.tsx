'use client';

import { useState } from 'react';
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
  const update = useUpdateUser();
  const isSA = user.role === 'SUPER_ADMIN';
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
          // SUPER_ADMIN perms are ignored server-side; otherwise null = follow role default.
          ...(isSA ? {} : { permissions: sameAsRole ? null : [...perms] }),
        },
      },
      {
        onSuccess: () => {
          toast.success('Changes saved');
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
          <DialogTitle>Edit — {user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Role
            <select
              disabled={isSA}
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground disabled:opacity-60"
            >
              {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Position
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as Position | '')}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"
            >
              <option value="">—</option>
              {(Object.keys(POSITION_LABELS) as Position[]).map((p) => (
                <option key={p} value={p}>{POSITION_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs text-muted-foreground">
            Department
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department | '')}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"
            >
              <option value="">—</option>
              {(Object.keys(DEPARTMENT_LABELS) as Department[]).map((d) => (
                <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Permissions {isSA ? '· Super Admin has full access' : '· effective'}
          </p>
          {!isSA ? (
            <Button variant="ghost" size="sm" onClick={resetDefaults}>
              <RotateCcw className="size-3.5" /> Reset to role defaults
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
                    checked={isSA || perms.has(p)}
                    disabled={isSA}
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

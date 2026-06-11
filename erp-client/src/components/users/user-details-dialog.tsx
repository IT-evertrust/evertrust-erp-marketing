'use client';

import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  POSITION_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  effectivePermissions,
  type AdminUserDto,
} from '@evertrust/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function UserDetailsDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const isSA = user.role === 'SUPER_ADMIN';
  const perms = effectivePermissions(user.role, user.permissions ?? null);
  const Field = ({ k, v }: { k: string; v: ReactNode }) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="text-[13.5px]">{v}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{user.name}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field k="Role" v={ROLE_LABELS[user.role]} />
          <Field k="Department" v={user.department ? DEPARTMENT_LABELS[user.department] : '—'} />
          <Field k="Position" v={user.position ? POSITION_LABELS[user.position] : '—'} />
          <Field k="Status" v={user.active ? 'Active' : 'Deactivated'} />
          <Field k="Joined" v={new Date(user.createdAt).toLocaleDateString()} />
          <Field
            k="Access"
            v={isSA ? 'Full access' : `${perms.length}/${PERMISSIONS.length} permissions`}
          />
        </div>
        <div className="mt-3 text-[10.5px] uppercase tracking-wide text-muted-foreground">
          Granted permissions
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isSA ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-emerald-500">
              <ShieldCheck className="size-3.5" /> All permissions
            </span>
          ) : perms.length ? (
            perms.map((p) => (
              <span key={p} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {p}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">None</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

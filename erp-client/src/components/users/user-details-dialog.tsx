'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import {
  PERMISSIONS,
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
  const t = useTranslations('users');
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
          <Field k={t('details.role')} v={t(`role.${user.role}`)} />
          <Field k={t('details.department')} v={user.department ? t(`department.${user.department}`) : '—'} />
          <Field k={t('details.position')} v={user.position ? t(`position.${user.position}`) : '—'} />
          <Field k={t('details.status')} v={user.active ? t('status.active') : t('status.deactivated')} />
          <Field k={t('details.joined')} v={new Date(user.createdAt).toLocaleDateString()} />
          <Field
            k={t('details.access')}
            v={isSA ? t('details.fullAccess') : t('details.permsCount', { count: perms.length, total: PERMISSIONS.length })}
          />
        </div>
        <div className="mt-3 text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {t('details.grantedPermissions')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {isSA ? (
            <span className="inline-flex items-center gap-1 text-[12.5px] text-emerald-500">
              <ShieldCheck className="size-3.5" /> {t('details.allPermissions')}
            </span>
          ) : perms.length ? (
            perms.map((p) => (
              <span key={p} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                {p}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">{t('details.none')}</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import type { AdminUserDto } from '@evertrust/shared';
import { useDeleteUser, useUpdateUser } from '@/hooks/use-admin-users';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function DeleteUserDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserDto;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('users');
  const del = useDeleteUser();
  const update = useUpdateUser();

  const doDelete = () =>
    del.mutate(user.id, {
      onSuccess: () => {
        toast.success(t('delete.deletedToast', { name: user.name }));
        onOpenChange(false);
      },
      // API returns 409 with a clear message when the user has linked records.
      onError: (e) => toast.error(e.message),
    });

  const doDeactivate = () =>
    update.mutate(
      { id: user.id, patch: { active: false } },
      {
        onSuccess: () => {
          toast.success(t('delete.deactivatedToast', { name: user.name }));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('delete.title')}</DialogTitle>
          <DialogDescription>
            {t.rich('delete.description', {
              name: user.name,
              email: user.email,
              b: (chunks) => <b className="text-foreground">{chunks}</b>,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="outline" onClick={doDeactivate} disabled={update.isPending}>
            {t('delete.deactivateInstead')}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('delete.cancel')}</Button>
            <Button variant="destructive" onClick={doDelete} disabled={del.isPending}>
              <Trash2 className="size-4" />
              {del.isPending ? t('delete.deleting') : t('delete.delete')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

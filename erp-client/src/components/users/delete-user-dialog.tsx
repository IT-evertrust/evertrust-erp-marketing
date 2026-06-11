'use client';

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
  const del = useDeleteUser();
  const update = useUpdateUser();

  const doDelete = () =>
    del.mutate(user.id, {
      onSuccess: () => {
        toast.success(`${user.name} deleted`);
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
          toast.success(`${user.name} deactivated`);
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete member?</DialogTitle>
          <DialogDescription>
            Permanently remove <b className="text-foreground">{user.name}</b> ({user.email})? This
            can&rsquo;t be undone and erases their history. In almost every case{' '}
            <b className="text-foreground">Deactivate</b> is the right choice — it revokes access but
            keeps the audit trail. (Members with linked records can&rsquo;t be deleted.)
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button variant="outline" onClick={doDeactivate} disabled={update.isPending}>
            Deactivate instead
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="destructive" onClick={doDelete} disabled={del.isPending}>
              <Trash2 className="size-4" />
              {del.isPending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

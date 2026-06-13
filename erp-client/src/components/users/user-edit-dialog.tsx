'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Department,
  Position,
  UserRole,
  type AdminUserDto,
  type UpdateUserDto,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NONE = '__none__';

// Compact "Edit profile" dialog for the /users/[id] profile page. Edits the
// member's placement (role / position / department) via PATCH /admin/users/:id.
// Role is locked for a Super Admin. Permissions are edited on the Users page;
// name + email aren't editable through the admin API (so they're not shown).
export function UserEditDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('users');
  const update = useUpdateUser();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<UserRole>(user.role);
  const [position, setPosition] = useState<Position | null>(user.position);
  const [department, setDepartment] = useState<Department | null>(
    user.department,
  );

  useEffect(() => {
    if (open) {
      setName(user.name);
      setPhone(user.phone ?? '');
      setRole(user.role);
      setPosition(user.position);
      setDepartment(user.department);
    }
  }, [open, user]);

  const roleLocked = user.role === 'SUPER_ADMIN';

  function save() {
    const patch: UpdateUserDto = { name, position, department };
    patch.phone = phone.trim() ? phone.trim() : null;
    if (!roleLocked) patch.role = role;
    update.mutate(
      { id: user.id, patch },
      {
        onSuccess: () => {
          toast.success(t('editProfile.savedToast', { name: user.name }));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message ?? t('editProfile.saveError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editProfile.title', { name: user.name })}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">{t('editProfile.name')}</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('editProfile.role')}</Label>
            <Select
              value={role}
              disabled={roleLocked}
              onValueChange={(v) => setRole(v as UserRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UserRole.options.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`role.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {roleLocked ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('editProfile.roleLocked')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('editProfile.position')}</Label>
            <Select
              value={position ?? NONE}
              onValueChange={(v) =>
                setPosition(v === NONE ? null : (v as Position))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('editProfile.none')}</SelectItem>
                {Position.options.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(`position.${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t('editProfile.department')}</Label>
            <Select
              value={department ?? NONE}
              onValueChange={(v) =>
                setDepartment(v === NONE ? null : (v as Department))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('editProfile.none')}</SelectItem>
                {Department.options.map((d) => (
                  <SelectItem key={d} value={d}>
                    {t(`department.${d}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-phone">{t('editProfile.phone')}</Label>
            <Input
              id="edit-phone"
              type="tel"
              value={phone}
              placeholder="—"
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {t('editProfile.footnote')}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('editProfile.cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? t('editProfile.saving') : t('editProfile.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

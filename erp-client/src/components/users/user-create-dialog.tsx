'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DEPARTMENT_LABELS,
  Department,
  POSITION_LABELS,
  Position,
  ROLE_LABELS,
  UserRole,
  type CreateUserDto,
} from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useCreateUser } from '@/hooks/use-admin-users';
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

// Create a teammate. This ERP has no public sign-up, so an admin (users:manage)
// sets the initial password here; the API creates the user + an argon2
// credential. Only a Super Admin can grant the SUPER_ADMIN role.
export function UserCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const { data: me } = useMe();
  const create = useCreateUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<UserRole>('EMPLOYEE');
  const [position, setPosition] = useState<Position | null>(null);
  const [department, setDepartment] = useState<Department | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setPassword('');
      setPhone('');
      setRole('EMPLOYEE');
      setPosition(null);
      setDepartment(null);
    }
  }, [open]);

  const canCreateSuperAdmin = me?.role === 'SUPER_ADMIN';
  const roleOptions = UserRole.options.filter(
    (r) => r !== 'SUPER_ADMIN' || canCreateSuperAdmin,
  );
  const valid =
    name.trim() !== '' &&
    /\S+@\S+\.\S+/.test(email) &&
    password.length >= 8;

  function submit() {
    const input: CreateUserDto = {
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      position,
      department,
      phone: phone.trim() ? phone.trim() : null,
    };
    create.mutate(input, {
      onSuccess: (u) => {
        toast.success(`Created ${u.name}.`);
        onCreated?.(u.id);
        onOpenChange(false);
      },
      onError: (e) => toast.error(e.message ?? 'Could not create the user.'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Create a teammate and set their initial password — there&apos;s no
            self sign-up.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-email">Email</Label>
              <Input
                id="c-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-pw">Initial password</Label>
              <Input
                id="c-pw"
                type="password"
                value={password}
                placeholder="At least 8 characters"
                onChange={(e) => setPassword(e.target.value)}
              />
              {password && password.length < 8 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Use at least 8 characters.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-phone">
                Phone <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="c-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Position</Label>
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
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {Position.options.map((p) => (
                    <SelectItem key={p} value={p}>
                      {POSITION_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Department</Label>
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
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {Department.options.map((d) => (
                    <SelectItem key={d} value={d}>
                      {DEPARTMENT_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Share the initial password with the new user so they can log in.
            Permissions follow the role and can be tuned after creation.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!valid || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

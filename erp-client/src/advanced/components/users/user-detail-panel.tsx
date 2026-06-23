'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronRight, ExternalLink } from 'lucide-react';
import {
  DEPARTMENT_LABELS,
  Department,
  PERMISSIONS,
  POSITION_LABELS,
  Position,
  ROLE_LABELS,
  UserRole,
  effectivePermissions,
  permissionsForRole,
  type AdminUserDto,
  type Permission,
  type UpdateUserDto,
} from '@evertrust/shared';
import { useMe } from '@/hooks/use-auth';
import { useDeleteUser, useUpdateUser } from '@/hooks/use-admin-users';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ConfirmButton } from '@/components/common/confirm-button';
import { cn } from '@/lib/utils';
import { ROLE_STYLES } from './role-styles';

const NONE = '__none__';

// The permission catalog grouped by resource (the part before ':') for the grid.
const PERMISSION_GROUPS: { resource: string; perms: Permission[] }[] = (() => {
  const map = new Map<string, Permission[]>();
  for (const p of PERMISSIONS) {
    const resource = p.split(':')[0]!;
    const arr = map.get(resource) ?? [];
    arr.push(p);
    map.set(resource, arr);
  }
  return [...map.entries()].map(([resource, perms]) => ({ resource, perms }));
})();

// How the permission set is being edited (mirrors the former edit dialog):
//  keep   — leave the user's stored permissions untouched (default)
//  reset  — follow the (possibly newly-picked) role's defaults => save null
//  custom — an explicit hand-picked set => save the array
type PermEdit =
  | { kind: 'keep' }
  | { kind: 'reset' }
  | { kind: 'custom'; set: Permission[] };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

// Small uppercase section heading, shared across the panel's cards.
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </h3>
  );
}

// A labelled form field (label + control + optional hint), used in the grids.
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// Inline detail/editor for the selected team member (right pane of the two-pane
// Users page). Grouped into cards — Identity + Details + Access, Permissions, a
// sticky Save bar, and a Danger zone — so the form reads as one cohesive whole.
// Edits save in one PATCH /admin/users/:id; (de)activate + delete are separate.
export function UserDetailPanel({ user }: { user: AdminUserDto }) {
  const { data: me } = useMe();
  const update = useUpdateUser();
  const del = useDeleteUser();
  const permRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [role, setRole] = useState<UserRole>(user.role);
  const [position, setPosition] = useState<Position | null>(user.position);
  const [department, setDepartment] = useState<Department | null>(
    user.department,
  );
  const [permEdit, setPermEdit] = useState<PermEdit>({ kind: 'keep' });

  // Reset the form whenever the selected user (or its saved values) changes.
  useEffect(() => {
    setName(user.name);
    setEmail(user.email);
    setPhone(user.phone ?? '');
    setRole(user.role);
    setPosition(user.position);
    setDepartment(user.department);
    setPermEdit({ kind: 'keep' });
  }, [user]);

  const roleLocked = user.role === 'SUPER_ADMIN';
  const formIsSuperAdmin = role === 'SUPER_ADMIN';
  const styles = ROLE_STYLES[user.role];
  // Email is the login identity — only a Super Admin may change it.
  const canEditEmail = me?.role === 'SUPER_ADMIN';

  const shown = useMemo<Set<Permission>>(() => {
    if (formIsSuperAdmin) return new Set(PERMISSIONS);
    if (permEdit.kind === 'custom') return new Set(permEdit.set);
    if (permEdit.kind === 'reset') return new Set(permissionsForRole(role));
    return new Set(effectivePermissions(user.role, user.permissions));
  }, [formIsSuperAdmin, permEdit, role, user]);

  const dirty =
    name !== user.name ||
    (canEditEmail && email !== user.email) ||
    phone !== (user.phone ?? '') ||
    role !== user.role ||
    position !== user.position ||
    department !== user.department ||
    permEdit.kind !== 'keep';

  function toggle(perm: Permission) {
    const next = new Set(shown);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    setPermEdit({ kind: 'custom', set: [...next] });
  }

  function onRoleChange(v: string) {
    setRole(v as UserRole);
    // Re-template permissions to the newly-picked role (follow-role).
    setPermEdit({ kind: 'reset' });
  }

  // Expand/collapse every resource group in the permission accordion.
  function setAllPerms(open: boolean) {
    permRef.current?.querySelectorAll('details').forEach((d) => {
      d.open = open;
    });
  }

  function save() {
    const patch: UpdateUserDto = { name, position, department };
    patch.phone = phone.trim() ? phone.trim() : null;
    if (canEditEmail && email !== user.email) patch.email = email;
    if (!roleLocked) patch.role = role;
    if (!formIsSuperAdmin) {
      if (permEdit.kind === 'custom') patch.permissions = permEdit.set;
      else if (permEdit.kind === 'reset') patch.permissions = null;
      // 'keep' => leave permissions unchanged (omit)
    }
    update.mutate(
      { id: user.id, patch },
      {
        onSuccess: () => toast.success(`Saved changes to ${user.name}.`),
        onError: (e) => toast.error(e.message ?? 'Could not save changes.'),
      },
    );
  }

  // (De)activation + delete. The API also enforces these guards.
  const isSelf = me?.id === user.id;
  const isSuperAdmin = user.role === 'SUPER_ADMIN';
  const blockDeactivate = isSelf || isSuperAdmin;
  const blockDelete = isSelf || isSuperAdmin;
  const deleteReason = isSelf
    ? 'You cannot delete your own account'
    : isSuperAdmin
      ? 'A Super Admin cannot be deleted'
      : undefined;
  const blockReason = isSelf
    ? 'You cannot deactivate your own account'
    : isSuperAdmin
      ? 'A Super Admin cannot be deactivated'
      : undefined;

  function setActive(active: boolean) {
    update.mutate(
      { id: user.id, patch: { active } },
      {
        onSuccess: () =>
          toast.success(
            active ? `Reactivated ${user.name}.` : `Deactivated ${user.name}.`,
          ),
        onError: (e) => toast.error(e.message ?? 'Could not update the user.'),
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* identity + editable fields */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-start gap-4 border-b bg-muted/20 p-5">
          <Avatar className="size-14">
            <AvatarFallback className={cn('text-base font-semibold', styles.tint)}>
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold leading-tight">
                {user.name}
              </span>
              <Badge
                className={cn(
                  'gap-1.5 border-transparent font-medium',
                  styles.tint,
                )}
              >
                <span className={cn('size-1.5 rounded-full', styles.dot)} />
                {ROLE_LABELS[user.role]}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5',
                  user.active
                    ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    user.active ? 'bg-emerald-500' : 'bg-muted-foreground',
                  )}
                />
                {user.active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
          </div>
          {isSelf ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/users/${user.id}`}>
                View profile
                <ExternalLink className="ml-1 size-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-4 p-5">
          <SectionTitle>Details</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="detail-name">
              <Input
                id="detail-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Email"
              htmlFor="detail-email"
              hint={
                !canEditEmail ? 'Only a Super Admin can change email.' : undefined
              }
            >
              <Input
                id="detail-email"
                type="email"
                value={canEditEmail ? email : user.email}
                disabled={!canEditEmail}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Phone" htmlFor="detail-phone">
              <Input
                id="detail-phone"
                type="tel"
                value={phone}
                placeholder="—"
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-4 p-5">
          <SectionTitle>Access</SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field
              label="Role"
              hint={roleLocked ? '🔒 Super Admin role is locked' : undefined}
            >
              <Select
                value={role}
                disabled={roleLocked}
                onValueChange={onRoleChange}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UserRole.options.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Position">
              <Select
                value={position ?? NONE}
                onValueChange={(v) =>
                  setPosition(v === NONE ? null : (v as Position))
                }
              >
                <SelectTrigger className="w-full">
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
            </Field>
            <Field label="Department">
              <Select
                value={department ?? NONE}
                onValueChange={(v) =>
                  setDepartment(v === NONE ? null : (v as Department))
                }
              >
                <SelectTrigger className="w-full">
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
            </Field>
          </div>
        </div>
      </div>

      {/* permissions */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 p-4">
          <div>
            <SectionTitle>Permissions</SectionTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formIsSuperAdmin
                ? 'Super Admin always has full access.'
                : 'What this member can see and do.'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAllPerms(true)}
            >
              Expand all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setAllPerms(false)}
            >
              Collapse all
            </Button>
            {!formIsSuperAdmin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setPermEdit({ kind: 'reset' })}
              >
                Reset to role defaults
              </Button>
            ) : null}
          </div>
        </div>
        <div ref={permRef} className="flex flex-col gap-2 p-3">
          {PERMISSION_GROUPS.map(({ resource, perms }) => {
            const granted = perms.filter((p) => shown.has(p)).length;
            const full = granted === perms.length;
            return (
              <details
                key={resource}
                className="group rounded-lg border bg-muted/20 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  <span className="font-medium capitalize">{resource}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums',
                      full
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : granted === 0
                          ? 'bg-muted text-muted-foreground'
                          : 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
                    )}
                  >
                    {granted}/{perms.length}
                  </span>
                </summary>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-3 py-3 pl-9">
                  {perms.map((p) => {
                    const action = p.split(':')[1] ?? p;
                    return (
                      <label
                        key={p}
                        className={cn(
                          'flex cursor-pointer items-center gap-1.5 text-sm',
                          formIsSuperAdmin && 'cursor-default opacity-70',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          checked={shown.has(p)}
                          disabled={formIsSuperAdmin}
                          onChange={() => toggle(p)}
                        />
                        {action}
                      </label>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </div>
      </div>

      {/* sticky save bar */}
      <div className="sticky bottom-3 z-10 flex items-center gap-3 rounded-xl border bg-card/90 px-4 py-3 shadow-sm backdrop-blur">
        <span className="truncate text-sm font-medium">{user.name}</span>
        {dirty ? (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Unsaved changes
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            All changes saved
          </span>
        )}
        <Button
          className="ml-auto"
          type="button"
          onClick={save}
          disabled={!dirty || update.isPending}
        >
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {/* danger zone */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-destructive">
          Danger zone
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {blockReason ??
            'Deactivate keeps the record + history; delete removes the account entirely.'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {user.active ? (
            <Button
              type="button"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={blockDeactivate || update.isPending}
              title={blockReason}
              onClick={() => setActive(false)}
            >
              Deactivate user
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={update.isPending}
              onClick={() => setActive(true)}
            >
              Reactivate user
            </Button>
          )}

          <ConfirmButton
            trigger={
              <Button
                type="button"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={blockDelete || del.isPending}
                title={deleteReason}
              >
                Delete user
              </Button>
            }
            title={`Delete ${user.name}?`}
            description="This permanently removes the user and their login. If the user has linked activity (audit trail, leads, pricing…), deletion is blocked — deactivate them instead."
            confirmLabel="Delete user"
            pending={del.isPending}
            onConfirm={() =>
              del.mutate(user.id, {
                onSuccess: () => toast.success(`Deleted ${user.name}.`),
                onError: (e) =>
                  toast.error(e.message ?? 'Could not delete the user.'),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { NicheTargetDto } from '@evertrust/shared';
import {
  useAddNicheTarget,
  useDeleteNicheTarget,
  useNicheTargets,
  useUpdateNicheTarget,
} from '@/hooks/use-niche-targets';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmButton } from '@/components/common/confirm-button';
import { cn } from '@/lib/utils';
import { TARGET_SOURCE_CLASS } from '@/lib/growth-format';

// Reusable per-niche target management: enable/disable each target, inline-edit its
// name + search hint, add a MANUAL target, delete. Source (AI vs MANUAL) is shown.
// Used on the campaign detail (via campaign.nicheId) and the niches page. Every
// control is wired to a real mutation; writes are gated by `campaigns:write`.
export function NicheTargets({
  nicheId,
  enabled = true,
}: {
  nicheId: string;
  enabled?: boolean;
}) {
  const q = useNicheTargets(nicheId, enabled);
  const add = useAddNicheTarget(nicheId);
  const [name, setName] = useState('');
  const [hint, setHint] = useState('');

  function onAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    add.mutate(
      { name: trimmed, searchHint: hint.trim() || undefined },
      {
        onSuccess: (t) => {
          toast.success(`Added target “${t.name}”.`);
          setName('');
          setHint('');
        },
        onError: (e) => toast.error(e.message ?? 'Could not add the target.'),
      },
    );
  }

  const targets = q.data ?? [];
  const aiCount = targets.filter((t) => t.source === 'AI').length;
  const enabledCount = targets.filter((t) => t.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      <Can permission="campaigns:write">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onAdd();
          }}
        >
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              New target
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dental clinics"
              className="w-48"
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Search hint (optional)
            </label>
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. Berlin, > 5 staff"
              className="w-56"
              maxLength={500}
            />
          </div>
          <Button type="submit" disabled={add.isPending || !name.trim()}>
            {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
            Add target
          </Button>
        </form>
      </Can>

      {q.isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          Could not load targets: {q.error.message}
        </p>
      ) : targets.length === 0 ? (
        <p className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No targets yet. Add a manual one above, or let the Niche Analytics
          workflow discover them.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between border-b px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>Targets</span>
            <span className="tabular-nums">
              {enabledCount}/{targets.length} enabled · {aiCount} AI
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Search hint</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Status</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.map((t) => (
                <TargetRow key={t.id} target={t} nicheId={nicheId} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function TargetRow({
  target: t,
  nicheId,
}: {
  target: NicheTargetDto;
  nicheId: string;
}) {
  const update = useUpdateNicheTarget(nicheId);
  const del = useDeleteNicheTarget(nicheId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [hint, setHint] = useState(t.searchHint ?? '');

  function toggleEnabled() {
    update.mutate(
      { id: t.id, patch: { enabled: !t.enabled } },
      {
        onSuccess: () =>
          toast.success(`${!t.enabled ? 'Enabled' : 'Disabled'} “${t.name}”.`),
        onError: (e) => toast.error(e.message ?? 'Could not update the target.'),
      },
    );
  }

  function saveEdit() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty.');
      return;
    }
    update.mutate(
      {
        id: t.id,
        patch: { name: trimmed, searchHint: hint.trim() || null },
      },
      {
        onSuccess: () => {
          toast.success('Target updated.');
          setEditing(false);
        },
        onError: (e) => toast.error(e.message ?? 'Could not update the target.'),
      },
    );
  }

  function onDelete() {
    del.mutate(t.id, {
      onSuccess: () => toast.success(`Removed “${t.name}”.`),
      onError: (e) => toast.error(e.message ?? 'Could not delete the target.'),
    });
  }

  if (editing) {
    return (
      <TableRow>
        <TableCell>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="h-8 w-40"
            autoFocus
          />
        </TableCell>
        <TableCell colSpan={3}>
          <Input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            maxLength={500}
            placeholder="Search hint"
            className="h-8 w-full max-w-sm"
          />
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={saveEdit}
              disabled={update.isPending}
              aria-label="Save"
            >
              {update.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check className="text-emerald-500" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => {
                setEditing(false);
                setName(t.name);
                setHint(t.searchHint ?? '');
              }}
              aria-label="Cancel"
            >
              <X />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={cn(!t.enabled && 'opacity-60')}>
      <TableCell className="font-medium">{t.name}</TableCell>
      <TableCell className="text-muted-foreground">
        {t.searchHint || '—'}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={TARGET_SOURCE_CLASS[t.source]}>
          {t.source}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <Can
          permission="campaigns:write"
          fallback={
            <span
              className={cn(
                'text-xs font-medium',
                t.enabled ? 'text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {t.enabled ? 'Enabled' : 'Disabled'}
            </span>
          }
        >
          <Button
            size="sm"
            variant="outline"
            onClick={toggleEnabled}
            disabled={update.isPending}
            aria-pressed={t.enabled}
            className={cn(
              'h-7 min-w-[88px]',
              t.enabled
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'text-muted-foreground',
            )}
          >
            {update.isPending ? (
              <Loader2 className="animate-spin" />
            ) : null}
            {t.enabled ? 'Enabled' : 'Disabled'}
          </Button>
        </Can>
      </TableCell>
      <TableCell>
        <Can permission="campaigns:write">
          <div className="flex justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground"
              onClick={() => setEditing(true)}
              aria-label={`Edit ${t.name}`}
            >
              <Pencil />
            </Button>
            <ConfirmButton
              trigger={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${t.name}`}
                >
                  <Trash2 />
                </Button>
              }
              title={`Delete “${t.name}”?`}
              description="This removes the target from the niche. AI discovery may re-add it on the next run."
              confirmLabel="Delete target"
              pending={del.isPending}
              onConfirm={onDelete}
            />
          </div>
        </Can>
      </TableCell>
    </TableRow>
  );
}

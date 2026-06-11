'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KPI_CATEGORY_LABELS, type ScorecardDto } from '@evertrust/shared';
import { useCreateKpiValue, useKpiDefinitions } from '@/hooks/use-performance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// Current ISO week [Monday, +7d) as ISO strings — must match the API collector's
// period so the entered value lands in the live scorecard.
function currentWeek(): { start: string; end: string } {
  const start = new Date();
  const day = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Manager records a MANUAL KPI value (the no-source KPIs). AUTO KPIs are excluded —
// they're collected from real ERP data and would be overwritten on the next read.
export function RecordKpiDialog({
  cards,
  open,
  onOpenChange,
}: {
  cards: ScorecardDto[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const defs = useKpiDefinitions();
  const create = useCreateKpiValue();
  const [userId, setUserId] = useState('');
  const [kpiKey, setKpiKey] = useState('');
  const [value, setValue] = useState('');

  const selectedUser = cards.find((c) => c.userId === userId);
  const options = useMemo(() => {
    const dept = selectedUser?.department ?? null;
    return (defs.data ?? []).filter(
      (d) => d.source !== 'AUTO' && (d.department === dept || d.department === null),
    );
  }, [defs.data, selectedUser]);

  const submit = () => {
    const def = options.find((d) => d.key === kpiKey);
    if (!userId || !def) {
      toast.error('Pick an employee and a KPI.');
      return;
    }
    const num = value.trim() === '' ? null : Number(value.replace(/[^0-9.-]/g, ''));
    const { start, end } = currentWeek();
    create.mutate(
      {
        userId,
        kpiKey,
        periodStart: start,
        periodEnd: end,
        numericValue: num,
        displayValue: value.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(`Recorded ${def.label} for ${selectedUser?.userName}`);
          setValue('');
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a KPI value</DialogTitle>
          <DialogDescription>
            For KPIs with no automatic source (manager-entered). Auto-collected KPIs aren’t listed —
            they come from real ERP data.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Employee
            <select
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setKpiKey('');
              }}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground"
            >
              <option value="">Select…</option>
              {cards.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.userName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            KPI
            <select
              value={kpiKey}
              onChange={(e) => setKpiKey(e.target.value)}
              disabled={!userId}
              className="h-9 rounded-md border bg-card px-2 text-sm text-foreground disabled:opacity-50"
            >
              <option value="">{userId ? 'Select…' : 'Pick an employee first'}</option>
              {options.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label} · {KPI_CATEGORY_LABELS[d.category]}
                  {d.target ? ` (target ${d.target})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Value
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 92%  ·  8  ·  €1.2M"
              className="h-9"
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Record value'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

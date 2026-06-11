'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, X } from 'lucide-react';
import { useUpdateLineItem } from '@/hooks/use-pricing';
import { useCanState } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/pricing-format';

// Inline editor for a line's unit price (bidEp). Read-only display until the
// pencil is clicked (tenders:write), then a number input with save/cancel.
// Saving PATCHes the line; the server recomputes bidGp (handled by the mutation
// invalidating the pricing query). When the user lacks tenders:write the value
// renders as plain read-only text.
export function BidEpCell({
  tenderId,
  lineId,
  bidEp,
  currency,
}: {
  tenderId: string;
  lineId: string;
  bidEp: string | null;
  currency: string;
}) {
  const { allowed } = useCanState('tenders:write');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(bidEp ?? '');
  const update = useUpdateLineItem(tenderId);

  function start() {
    setValue(bidEp ?? '');
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setValue(bidEp ?? '');
  }

  function save() {
    const trimmed = value.trim();
    if (trimmed && !Number.isFinite(Number(trimmed))) {
      toast.error('Unit price must be a number.');
      return;
    }
    // No-op if unchanged.
    if (trimmed === (bidEp ?? '')) {
      setEditing(false);
      return;
    }
    update.mutate(
      { lineId, input: { bidEp: trimmed === '' ? undefined : trimmed } },
      {
        onSuccess: () => {
          toast.success('Unit price updated.');
          setEditing(false);
        },
        onError: (error) =>
          toast.error(error.message ?? 'Could not update unit price.'),
      },
    );
  }

  if (!allowed) {
    return (
      <span className="tabular-nums">{formatMoney(bidEp, currency)}</span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        className="group inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 tabular-nums hover:bg-accent"
        title="Edit unit price"
      >
        {formatMoney(bidEp, currency)}
        <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        type="number"
        inputMode="decimal"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') cancel();
        }}
        className="h-8 w-28"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={save}
        disabled={update.isPending}
        aria-label="Save unit price"
      >
        <Check />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={cancel}
        disabled={update.isPending}
        aria-label="Cancel"
      >
        <X />
      </Button>
    </div>
  );
}

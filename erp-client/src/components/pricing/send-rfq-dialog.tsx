'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import type { LinePricingDto } from '@evertrust/shared';
import { useSuppliers } from '@/hooks/use-suppliers';
import { useSendRfq } from '@/hooks/use-rfq';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type Scope = 'unbacked' | 'all';

// Phase 5c — dispatch a Hermes supplier RFQ for this tender. Pick suppliers (from
// the registry), choose which lines to ask about (default: the UNBACKED lines —
// the ones that need a real quote), add an optional message, and send. The ERP
// fires the Hermes n8n webhook server-side and records the dispatch; replies come
// back later as SUPPLIER_QUOTE observations. pricing:write — gated by the caller.
export function SendRfqDialog({
  tenderId,
  lines,
}: {
  tenderId: string;
  lines: LinePricingDto[];
}) {
  const unbacked = lines.filter((l) => !l.backed);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>(
    unbacked.length > 0 ? 'unbacked' : 'all',
  );
  const [note, setNote] = useState('');
  const suppliers = useSuppliers();
  const send = useSendRfq(tenderId);

  function reset() {
    setSelected(new Set());
    setScope(unbacked.length > 0 ? 'unbacked' : 'all');
    setNote('');
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const supplierIds = [...selected];
    if (supplierIds.length === 0) {
      toast.error('Pick at least one supplier.');
      return;
    }
    const scoped = scope === 'unbacked' ? unbacked : lines;
    const lineItemIds = scoped.map((l) => l.lineItem.id);

    send.mutate(
      { supplierIds, lineItemIds, note: note.trim() || undefined },
      {
        onSuccess: (row) => {
          if (row.status === 'DISPATCHED') {
            toast.success(
              `RFQ sent to ${supplierIds.length} supplier${supplierIds.length > 1 ? 's' : ''}.`,
            );
          } else {
            toast.error(
              `RFQ recorded, but the Hermes webhook failed${row.detail ? `: ${row.detail}` : ''}.`,
            );
          }
          onOpenChange(false);
        },
        onError: (e) => toast.error(e.message ?? 'Could not send the RFQ.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Send />
          Request quotes
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request supplier quotes</DialogTitle>
          <DialogDescription>
            Email an RFQ to suppliers via Hermes. Replies are recorded as supplier
            quotes and back the lines GREEN.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label>Suppliers</Label>
            <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
              {suppliers.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading suppliers…</p>
              ) : suppliers.data && suppliers.data.length > 0 ? (
                suppliers.data.map((s) => (
                  <label
                    key={s.id}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="truncate">{s.name}</span>
                    {s.contact ? (
                      <span className="ml-auto truncate text-xs text-muted-foreground">
                        {s.contact}
                      </span>
                    ) : null}
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No suppliers yet. Add suppliers in the registry first.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rfq-scope">Lines to quote</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger id="rfq-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unbacked">
                  Unbacked lines ({unbacked.length})
                </SelectItem>
                <SelectItem value="all">All lines ({lines.length})</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rfq-note">Message (optional)</Label>
            <Textarea
              id="rfq-note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for the suppliers (deadline, delivery, etc.)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={send.isPending || selected.size === 0}
          >
            {send.isPending ? 'Sending…' : 'Send RFQ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

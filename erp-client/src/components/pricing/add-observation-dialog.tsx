'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { PriceSource } from '@evertrust/shared';
import { useAddObservation } from '@/hooks/use-pricing';
import { useSuppliers } from '@/hooks/use-suppliers';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PRICE_SOURCE_LABEL, PRICE_SOURCE_ORDER } from '@/lib/pricing-format';

const NO_SUPPLIER = '__none__';

// Add a price observation to a line (pricing:write — gated by the caller). Pick a
// source (the 7 PriceSource values), an optional supplier (from suppliers.list),
// a price, and an optional note. The engine re-weights the line's evidence on
// success (handled by the mutation invalidating the pricing query).
export function AddObservationDialog({
  tenderId,
  lineId,
}: {
  tenderId: string;
  lineId: string;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PriceSource>('SUPPLIER_QUOTE');
  const [supplierId, setSupplierId] = useState<string>(NO_SUPPLIER);
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const suppliers = useSuppliers();
  const add = useAddObservation(tenderId, lineId);

  function reset() {
    setSource('SUPPLIER_QUOTE');
    setSupplierId(NO_SUPPLIER);
    setPrice('');
    setNote('');
  }

  function submit() {
    const trimmed = price.trim();
    // Validate against the same numeric-string contract the API enforces.
    if (!trimmed || !Number.isFinite(Number(trimmed))) {
      toast.error('Enter a valid price.');
      return;
    }
    add.mutate(
      {
        source,
        price: trimmed,
        supplierId: supplierId === NO_SUPPLIER ? undefined : supplierId,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Observation added.');
          setOpen(false);
          reset();
        },
        onError: (error) =>
          toast.error(error.message ?? 'Could not add observation.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add observation
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add price observation</DialogTitle>
          <DialogDescription>
            Record evidence for this line. The highest-trust source sets the
            suggested price; supplier quotes turn the line GREEN.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="obs-source">Source</Label>
            <Select
              value={source}
              onValueChange={(v) => setSource(v as PriceSource)}
            >
              <SelectTrigger id="obs-source" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_SOURCE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PRICE_SOURCE_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obs-supplier">Supplier (optional)</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger id="obs-supplier" className="w-full">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SUPPLIER}>None</SelectItem>
                {suppliers.data?.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obs-price">Price</Label>
            <Input
              id="obs-price"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obs-note">Note (optional)</Label>
            <Textarea
              id="obs-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Context for this observation"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

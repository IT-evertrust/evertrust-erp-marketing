'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useCreateLineItem } from '@/hooks/use-pricing';
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

// Add an LV line item (tenders:write — gated by the caller). position +
// description are required; qty/unit/bidEp are optional (bidGp is server-derived
// from qty*bidEp, never set here).
export function AddLineDialog({ tenderId }: { tenderId: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState('');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [bidEp, setBidEp] = useState('');
  const create = useCreateLineItem(tenderId);

  function reset() {
    setPosition('');
    setDescription('');
    setQty('');
    setUnit('');
    setBidEp('');
  }

  function submit() {
    if (!position.trim() || !description.trim()) {
      toast.error('Position and description are required.');
      return;
    }
    if (bidEp.trim() && !Number.isFinite(Number(bidEp.trim()))) {
      toast.error('Unit price must be a number.');
      return;
    }
    create.mutate(
      {
        position: position.trim(),
        description: description.trim(),
        qty: qty.trim() || undefined,
        unit: unit.trim() || undefined,
        bidEp: bidEp.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success('Line added.');
          setOpen(false);
          reset();
        },
        onError: (error) => toast.error(error.message ?? 'Could not add line.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus />
          Add line
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add line item</DialogTitle>
          <DialogDescription>
            Add a position to the LV. The unit price (EP) drives the line total
            (GP = qty × EP), computed server-side.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="line-position">Position</Label>
              <Input
                id="line-position"
                value={position}
                maxLength={50}
                onChange={(e) => setPosition(e.target.value)}
                placeholder="1.1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="line-description">Description</Label>
              <Input
                id="line-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Item description"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="line-qty">Qty</Label>
              <Input
                id="line-qty"
                type="number"
                inputMode="decimal"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="line-unit">Unit</Label>
              <Input
                id="line-unit"
                value={unit}
                maxLength={20}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="pcs"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="line-ep">Unit price</Label>
              <Input
                id="line-ep"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={bidEp}
                onChange={(e) => setBidEp(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

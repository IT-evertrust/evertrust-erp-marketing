'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useCreateLead } from '@/hooks/use-leads';
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
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

// Manually add a hot lead (so Key Account is useful even before n8n sync).
export function AddLeadDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLead();
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [niche, setNiche] = useState('');
  const [tier, setTier] = useState('');
  const [note, setNote] = useState('');

  const reset = () => {
    setEmail('');
    setCompanyName('');
    setNiche('');
    setTier('');
    setNote('');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        email: email.trim(),
        companyName: companyName.trim() || undefined,
        niche: niche.trim() || undefined,
        tier: tier.trim() || undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          reset();
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add hot lead</DialogTitle>
            <DialogDescription>
              Add a lead by hand. It lands in the Interested column.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-3">
            <div className="grid gap-1.5">
              <Label htmlFor="lead-email">Email *</Label>
              <Input
                id="lead-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contact@company.com"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-company">Company</Label>
              <Input
                id="lead-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="lead-niche">Niche</Label>
                <Input
                  id="lead-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lead-tier">Tier</Label>
                <Input
                  id="lead-tier"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  placeholder="AAA"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-note">Note</Label>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          {create.isError ? (
            <p className="text-sm text-destructive">{create.error.message}</p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || !email.trim()}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Add lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

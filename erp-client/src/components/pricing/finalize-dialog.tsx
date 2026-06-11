'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import type { TenderPricingDto } from '@evertrust/shared';
import { useFinalizePricing } from '@/hooks/use-pricing';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatMoney } from '@/lib/pricing-format';

// Finalize confirm dialog (pricing:approve — gated by the caller). Locks pricing
// FINAL and moves the tender to CUSTOMER_PRICING. Surfaces the high-risk warning
// inside the confirm so the approver sees it before committing. Already-FINAL
// pricing disables the action.
export function FinalizeDialog({
  tenderId,
  pricing,
}: {
  tenderId: string;
  pricing: TenderPricingDto;
}) {
  const [open, setOpen] = useState(false);
  const finalize = useFinalizePricing(tenderId);
  const isFinal = pricing.status === 'FINAL';

  function confirm() {
    finalize.mutate(undefined, {
      onSuccess: () => {
        toast.success('Pricing finalized — tender moved to Customer pricing.');
        setOpen(false);
      },
      onError: (error) =>
        toast.error(error.message ?? 'Could not finalize pricing.'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={isFinal} className="w-full">
          <CheckCircle2 />
          {isFinal ? 'Pricing finalized' : 'Finalize pricing'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Finalize pricing?</DialogTitle>
          <DialogDescription>
            This locks the pricing as FINAL and moves the tender to Customer
            pricing. Final price is{' '}
            <span className="font-medium text-foreground">
              {formatMoney(pricing.finalPrice, pricing.currency)}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        {pricing.highRisk ? (
          <Alert variant="destructive">
            <AlertTitle>High-risk pricing</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {pricing.riskReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={finalize.isPending}>
            {finalize.isPending ? 'Finalizing…' : 'Confirm finalize'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  const finalize = useFinalizePricing(tenderId);
  const isFinal = pricing.status === 'FINAL';

  function confirm() {
    finalize.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('pricing.finalize.finalizedToast'));
        setOpen(false);
      },
      onError: (error) =>
        toast.error(error.message ?? t('pricing.finalize.finalizeError')),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={isFinal} className="w-full">
          <CheckCircle2 />
          {isFinal ? t('pricing.finalize.finalized') : t('pricing.finalize.finalize')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pricing.finalize.title')}</DialogTitle>
          <DialogDescription>
            {t.rich('pricing.finalize.description', {
              price: formatMoney(pricing.finalPrice, pricing.currency),
              amount: (chunks) => (
                <span className="font-medium text-foreground">{chunks}</span>
              ),
            })}
          </DialogDescription>
        </DialogHeader>
        {pricing.highRisk ? (
          <Alert variant="destructive">
            <AlertTitle>{t('pricing.finalize.highRiskTitle')}</AlertTitle>
            <AlertDescription>
              {/* Risk reasons are produced server-side and rendered verbatim. */}
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
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={confirm} disabled={finalize.isPending}>
            {finalize.isPending ? t('pricing.finalize.finalizing') : t('pricing.finalize.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

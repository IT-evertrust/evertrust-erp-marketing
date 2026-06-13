'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import {
  nextStates,
  type TenderDto,
  type TenderStatus,
} from '@evertrust/shared';
import { toast } from 'sonner';
import { useTransitionTender } from '@/hooks/use-tenders';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { StatusBadge } from './status-badge';

// Lifecycle transition control. Offers the legal next states from the shared state
// machine (nextStates), each gated by tenders:transition. SUBMITTED is deliberately
// EXCLUDED here: submission runs through the Submission card (POST /tenders/:id/submit),
// which enforces the customer-approval + QC gate AND logs the proof — so SUBMITTED is
// never a bare status flip. Terminal states render a "no further transitions" note.
export function TenderTransition({ tender }: { tender: TenderDto }) {
  const t = useTranslations('tenders');
  // SUBMITTED is handled by the Submission card, not as a generic transition.
  const targets = nextStates(tender.status).filter((s) => s !== 'SUBMITTED');
  const submitIsNext = nextStates(tender.status).includes('SUBMITTED');
  const transition = useTransitionTender(tender.id);

  function go(to: TenderStatus) {
    transition.mutate(
      { to },
      {
        onSuccess: (updated) =>
          toast.success(t('transition.moved', { status: t(`status.${updated.status}`) })),
        onError: (error) => toast.error(error.message ?? t('transition.failed')),
      },
    );
  }

  if (targets.length === 0 && !submitIsNext) {
    return (
      <p className="text-sm text-muted-foreground">
        {t.rich('transition.terminal', {
          status: () => <StatusBadge status={tender.status} />,
        })}
      </p>
    );
  }

  return (
    <Can
      permission="tenders:transition"
      fallback={
        <p className="text-sm text-muted-foreground">
          {t('transition.noPermission')}
        </p>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((to) => (
          <Button
            key={to}
            variant="outline"
            size="sm"
            disabled={transition.isPending}
            onClick={() => go(to)}
          >
            <ArrowRight />
            {t(`status.${to}`)}
          </Button>
        ))}
      </div>
      {submitIsNext ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t.rich('transition.submitHint', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      ) : null}
    </Can>
  );
}

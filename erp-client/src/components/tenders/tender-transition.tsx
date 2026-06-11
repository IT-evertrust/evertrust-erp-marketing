'use client';

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
import { STATUS_LABEL } from '@/lib/tender-format';
import { StatusBadge } from './status-badge';

// Lifecycle transition control. Offers the legal next states from the shared state
// machine (nextStates), each gated by tenders:transition. SUBMITTED is deliberately
// EXCLUDED here: submission runs through the Submission card (POST /tenders/:id/submit),
// which enforces the customer-approval + QC gate AND logs the proof — so SUBMITTED is
// never a bare status flip. Terminal states render a "no further transitions" note.
export function TenderTransition({ tender }: { tender: TenderDto }) {
  // SUBMITTED is handled by the Submission card, not as a generic transition.
  const targets = nextStates(tender.status).filter((t) => t !== 'SUBMITTED');
  const submitIsNext = nextStates(tender.status).includes('SUBMITTED');
  const transition = useTransitionTender(tender.id);

  function go(to: TenderStatus) {
    transition.mutate(
      { to },
      {
        onSuccess: (updated) =>
          toast.success(`Moved to ${STATUS_LABEL[updated.status]}.`),
        onError: (error) => toast.error(error.message ?? 'Transition failed.'),
      },
    );
  }

  if (targets.length === 0 && !submitIsNext) {
    return (
      <p className="text-sm text-muted-foreground">
        <StatusBadge status={tender.status} /> is terminal — no further
        transitions.
      </p>
    );
  }

  return (
    <Can
      permission="tenders:transition"
      fallback={
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to move this tender.
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
            {STATUS_LABEL[to]}
          </Button>
        ))}
      </div>
      {submitIsNext ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Ready to submit? Use the <strong>Submission</strong> card below — it
          enforces the approval + QC gate and records the proof.
        </p>
      ) : null}
    </Can>
  );
}

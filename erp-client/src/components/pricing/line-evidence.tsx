'use client';

import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import type { PriceObservationDto } from '@evertrust/shared';
import {
  useDeleteObservation,
  useLineItemObservations,
} from '@/hooks/use-pricing';
import { useSuppliers } from '@/hooks/use-suppliers';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/tender-format';
import { formatMoney } from '@/lib/pricing-format';
import { AddObservationDialog } from './add-observation-dialog';

// Expanded per-line price evidence: lists the line's observations (source,
// supplier, price, note, when) with a delete control (pricing:write) and the
// add-observation dialog. Only mounted when the row is expanded, so observations
// are fetched lazily (the hook's `enabled` keys off lineId).
export function LineEvidence({
  tenderId,
  lineId,
  currency,
}: {
  tenderId: string;
  lineId: string;
  currency: string;
}) {
  const t = useTranslations('tenders');
  const observations = useLineItemObservations(lineId);
  const suppliers = useSuppliers();

  // id -> name for resolving the optional supplier on a supplier quote.
  const supplierName = (id: string | null): string | null => {
    if (!id) return null;
    return suppliers.data?.find((s) => s.id === id)?.name ?? id;
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('pricing.evidence.title')}
        </h4>
        <Can permission="pricing:write">
          <AddObservationDialog tenderId={tenderId} lineId={lineId} />
        </Can>
      </div>

      {observations.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : observations.data && observations.data.length > 0 ? (
        <ul className="divide-y divide-border">
          {observations.data.map((obs) => (
            <ObservationRow
              key={obs.id}
              tenderId={tenderId}
              lineId={lineId}
              obs={obs}
              currency={currency}
              supplierName={supplierName(obs.supplierId)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t('pricing.evidence.empty')}
        </p>
      )}
    </div>
  );
}

function ObservationRow({
  tenderId,
  lineId,
  obs,
  currency,
  supplierName,
}: {
  tenderId: string;
  lineId: string;
  obs: PriceObservationDto;
  currency: string;
  supplierName: string | null;
}) {
  const t = useTranslations('tenders');
  const del = useDeleteObservation(tenderId, lineId);

  function remove() {
    del.mutate(obs.id, {
      onSuccess: () => toast.success(t('pricing.evidence.removedToast')),
      onError: (error) =>
        toast.error(error.message ?? t('pricing.evidence.removeError')),
    });
  }

  return (
    <li className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t(`pricing.priceSource.${obs.source}`)}</Badge>
          <span className="font-medium tabular-nums">
            {formatMoney(obs.price, obs.currency || currency)}
          </span>
          {supplierName ? (
            <span className="text-sm text-muted-foreground">
              · {supplierName}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(obs.observedAt)}
          {obs.note ? ` · ${obs.note}` : ''}
        </p>
      </div>
      <Can permission="pricing:write">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={remove}
          disabled={del.isPending}
          aria-label={t('pricing.evidence.removeObservation')}
          title={t('pricing.evidence.removeObservation')}
        >
          <Trash2 />
        </Button>
      </Can>
    </li>
  );
}

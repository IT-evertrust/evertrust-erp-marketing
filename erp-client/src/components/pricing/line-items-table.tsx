'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Trash2, Wand2 } from 'lucide-react';
import type { LinePricingDto } from '@evertrust/shared';
import { useDeleteLineItem, useUpdateLineItem } from '@/hooks/use-pricing';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  SIGNAL_TEXT_CLASS,
  formatConfidence,
  formatMoney,
  formatSuggested,
} from '@/lib/pricing-format';
import { RygBadge } from './ryg-badge';
import { BidEpCell } from './bid-ep-cell';
import { LineEvidence } from './line-evidence';
import { PriceAssistDialog } from './price-assist-dialog';

// The LV line-items table with the engine suggestion per line. Each row shows
// position · description · qty · unit · editable bidEp · computed bidGp · the
// suggestion (R/Y/G badge + suggestedPrice + confidence + signal + obs count).
// Rows expand to reveal price evidence. The data is the pricing query's per-line
// rows (lineItem + computed fields), so the table and engine never drift.
export function LineItemsTable({
  tenderId,
  lines,
  currency,
}: {
  tenderId: string;
  lines: LinePricingDto[];
  currency: string;
}) {
  const t = useTranslations('tenders');
  const [expanded, setExpanded] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        {t('pricing.lines.empty')}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead className="w-16">{t('pricing.lines.header.position')}</TableHead>
          <TableHead className="min-w-48">{t('pricing.lines.header.description')}</TableHead>
          <TableHead className="text-right">{t('pricing.lines.header.qty')}</TableHead>
          <TableHead>{t('pricing.lines.header.unit')}</TableHead>
          <TableHead className="text-right">{t('pricing.lines.header.unitPrice')}</TableHead>
          <TableHead className="text-right">{t('pricing.lines.header.lineTotal')}</TableHead>
          <TableHead className="min-w-56">{t('pricing.lines.header.engineSuggestion')}</TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <LineRow
            key={line.lineItem.id}
            tenderId={tenderId}
            line={line}
            currency={currency}
            isExpanded={expanded === line.lineItem.id}
            onToggle={() =>
              setExpanded((cur) =>
                cur === line.lineItem.id ? null : line.lineItem.id,
              )
            }
          />
        ))}
      </TableBody>
    </Table>
  );
}

function LineRow({
  tenderId,
  line,
  currency,
  isExpanded,
  onToggle,
}: {
  tenderId: string;
  line: LinePricingDto;
  currency: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations('tenders');
  const { lineItem: li } = line;
  const del = useDeleteLineItem(tenderId);
  const update = useUpdateLineItem(tenderId);

  function remove() {
    del.mutate(li.id, {
      onSuccess: () => toast.success(t('pricing.lines.removedToast')),
      onError: (error) => toast.error(error.message ?? t('pricing.lines.removeError')),
    });
  }

  // "Use" convenience: set this line's bidEp to the engine's suggestedPrice.
  function useSuggested() {
    if (line.suggestedPrice === null) return;
    update.mutate(
      { lineId: li.id, input: { bidEp: String(line.suggestedPrice) } },
      {
        onSuccess: () => toast.success(t('pricing.lines.appliedToast')),
        onError: (error) =>
          toast.error(error.message ?? t('pricing.lines.applyError')),
      },
    );
  }

  return (
    <Fragment>
      <TableRow className={cn(isExpanded && 'border-b-0')}>
        <TableCell>
          <button
            type="button"
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground"
            aria-label={isExpanded ? t('pricing.lines.collapseEvidence') : t('pricing.lines.expandEvidence')}
          >
            {isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        </TableCell>
        <TableCell className="font-mono text-xs">{li.position}</TableCell>
        <TableCell className="max-w-xs">
          <span className="block truncate" title={li.description}>
            {li.description}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{li.qty}</TableCell>
        <TableCell className="text-muted-foreground">{li.unit}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end">
            <BidEpCell
              tenderId={tenderId}
              lineId={li.id}
              bidEp={li.bidEp}
              currency={currency}
            />
          </div>
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">
          {formatMoney(li.bidGp, currency)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <RygBadge ryg={line.ryg} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium tabular-nums">
                  {formatSuggested(line.suggestedPrice, currency)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('pricing.lines.confidence', { value: formatConfidence(line.confidence) })}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className={SIGNAL_TEXT_CLASS[line.signal]}>
                  {t(`pricing.signal.${line.signal}`)}
                </span>
                {' · '}
                {t('pricing.lines.obs', { count: line.observationCount })}
              </div>
            </div>
            {line.suggestedPrice !== null ? (
              <Can permission="tenders:write">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={useSuggested}
                  disabled={update.isPending}
                  title={t('pricing.lines.useSuggestedTitle')}
                  className="ml-auto"
                >
                  <Wand2 />
                  {t('pricing.lines.useSuggested', { price: formatSuggested(line.suggestedPrice, currency) })}
                </Button>
              </Can>
            ) : null}
            {/* Unbacked line (no real evidence) → offer a Claude estimate to fill
                the gap. Gated by pricing:write (same as recording evidence). */}
            {!line.backed ? (
              <Can permission="pricing:write">
                <PriceAssistDialog
                  tenderId={tenderId}
                  lineItem={li}
                  currency={currency}
                />
              </Can>
            ) : null}
          </div>
        </TableCell>
        <TableCell>
          <Can permission="tenders:write">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={remove}
              disabled={del.isPending}
              aria-label={t('pricing.lines.removeLine')}
              title={t('pricing.lines.removeLine')}
            >
              <Trash2 />
            </Button>
          </Can>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={9} className="pt-0 pb-4">
            <LineEvidence
              tenderId={tenderId}
              lineId={li.id}
              currency={currency}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

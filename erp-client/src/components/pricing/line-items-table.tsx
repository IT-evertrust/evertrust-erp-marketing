'use client';

import { Fragment, useState } from 'react';
import { toast } from 'sonner';
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
  SIGNAL_LABEL,
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
  const [expanded, setExpanded] = useState<string | null>(null);

  if (lines.length === 0) {
    return (
      <p className="px-2 py-8 text-center text-sm text-muted-foreground">
        No line items yet. Add the first LV position to begin pricing.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead className="w-16">Pos.</TableHead>
          <TableHead className="min-w-48">Description</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead className="text-right">Line total</TableHead>
          <TableHead className="min-w-56">Engine suggestion</TableHead>
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
  const { lineItem: li } = line;
  const del = useDeleteLineItem(tenderId);
  const update = useUpdateLineItem(tenderId);

  function remove() {
    del.mutate(li.id, {
      onSuccess: () => toast.success('Line removed.'),
      onError: (error) => toast.error(error.message ?? 'Could not remove line.'),
    });
  }

  // "Use" convenience: set this line's bidEp to the engine's suggestedPrice.
  function useSuggested() {
    if (line.suggestedPrice === null) return;
    update.mutate(
      { lineId: li.id, input: { bidEp: String(line.suggestedPrice) } },
      {
        onSuccess: () => toast.success('Applied suggested price.'),
        onError: (error) =>
          toast.error(error.message ?? 'Could not apply suggestion.'),
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
            aria-label={isExpanded ? 'Collapse evidence' : 'Expand evidence'}
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
                  {formatConfidence(line.confidence)} conf
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                <span className={SIGNAL_TEXT_CLASS[line.signal]}>
                  {SIGNAL_LABEL[line.signal]}
                </span>
                {' · '}
                {line.observationCount} obs
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
                  title="Set unit price to the suggested price"
                  className="ml-auto"
                >
                  <Wand2 />
                  Use {formatSuggested(line.suggestedPrice, currency)}
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
              aria-label="Remove line"
              title="Remove line"
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

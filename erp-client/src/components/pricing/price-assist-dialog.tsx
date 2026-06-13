'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { LineItemDto } from '@evertrust/shared';
import { useAddObservation, usePriceAssist } from '@/hooks/use-pricing';
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
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing-format';

// Phase 5b — Claude price-assist. For an UNBACKED line, ask Claude for a unit-price
// SUGGESTION, then let a human accept it. Accepting records an AI_ESTIMATE
// observation (weight 40) — so the line stays unbacked/RED until a real quote backs
// it; Claude's number just fills the gap. The model never sets the price directly
// (human-in-the-loop). pricing:write is gated by the caller.
export function PriceAssistDialog({
  tenderId,
  lineItem,
  currency,
}: {
  tenderId: string;
  lineItem: LineItemDto;
  currency: string;
}) {
  const t = useTranslations('tenders');
  const [open, setOpen] = useState(false);
  // The price the human will actually record — prefilled with Claude's number but
  // editable, because the human decides.
  const [price, setPrice] = useState('');
  const assist = usePriceAssist(lineItem.id);
  const add = useAddObservation(tenderId, lineItem.id);

  const result = assist.data;
  const suggestion = result?.suggestion ?? null;

  function run() {
    assist.mutate(undefined, {
      onSuccess: (res) => {
        if (res.suggestion) setPrice(res.suggestion.unitPrice);
        else if (res.error) toast.error(res.error);
      },
      onError: (e) => toast.error(e.message ?? t('pricing.assist.failed')),
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Fire the estimate as the dialog opens (unless we already have one cached).
      if (!assist.data && !assist.isPending) run();
    } else {
      assist.reset();
      setPrice('');
    }
  }

  function accept() {
    const trimmed = price.trim();
    if (!trimmed || !Number.isFinite(Number(trimmed))) {
      toast.error(t('pricing.assist.priceError'));
      return;
    }
    const note = suggestion
      ? t('pricing.assist.noteWithConfidence', {
          confidence: Math.round(suggestion.confidence * 100),
          rationale: suggestion.rationale,
        }).slice(0, 500)
      : t('pricing.assist.noteFallback');
    add.mutate(
      { source: 'AI_ESTIMATE', price: trimmed, note },
      {
        onSuccess: () => {
          toast.success(t('pricing.assist.recordedToast'));
          setOpen(false);
          assist.reset();
          setPrice('');
        },
        onError: (e) => toast.error(e.message ?? t('pricing.assist.recordError')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto text-violet-300 hover:text-violet-200"
          title={t('pricing.assist.askClaudeTitle')}
        >
          <Sparkles />
          {t('pricing.assist.askClaude')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-violet-400" />
            {t('pricing.assist.title')}
          </DialogTitle>
          <DialogDescription className="truncate">
            {lineItem.position} · {lineItem.description}
          </DialogDescription>
        </DialogHeader>

        {assist.isPending ? (
          <div className="flex flex-col gap-3 py-2">
            <p className="text-sm text-muted-foreground">{t('pricing.assist.estimating')}</p>
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : result && !result.configured ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            {t.rich('pricing.assist.notConfigured', {
              code: (chunks) => (
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{chunks}</code>
              ),
            })}
          </div>
        ) : result?.error ? (
          <div className="flex flex-col gap-3">
            {/* The error message is produced server-side and rendered verbatim. */}
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-sm text-rose-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{result.error}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={run}>
              {t('pricing.assist.tryAgain')}
            </Button>
          </div>
        ) : suggestion ? (
          <div className="flex flex-col gap-4">
            {/* Suggested amount + confidence */}
            <div className="rounded-lg border border-violet-500/25 bg-violet-500/10 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-violet-300/80">
                  {t('pricing.assist.suggestedUnitPrice')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('pricing.assist.confidence', { value: Math.round(suggestion.confidence * 100) })}
                </span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-violet-100">
                {formatMoney(suggestion.unitPrice, currency)}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-violet-500/15">
                <div
                  className={cn(
                    'h-full rounded-full',
                    suggestion.lowConfidence ? 'bg-rose-400' : 'bg-violet-400',
                  )}
                  style={{
                    width: `${Math.round(suggestion.confidence * 100)}%`,
                  }}
                />
              </div>
            </div>

            {suggestion.lowConfidence ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t('pricing.assist.lowConfidence')}
                </span>
              </div>
            ) : null}

            {/* Rationale text is produced server-side and rendered verbatim. */}
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('pricing.assist.rationale')}
              </p>
              <p className="text-sm">{suggestion.rationale}</p>
            </div>

            {suggestion.assumptions.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t('pricing.assist.assumptions')}
                </p>
                {/* Assumption items are produced server-side and rendered verbatim. */}
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {suggestion.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="assist-price">{t('pricing.assist.priceToRecord')}</Label>
              <Input
                id="assist-price"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t.rich('pricing.assist.recordedAs', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </p>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {suggestion ? t('common.cancel') : t('common.close')}
          </Button>
          {suggestion ? (
            <Button type="button" onClick={accept} disabled={add.isPending}>
              {add.isPending ? t('pricing.assist.recording') : t('pricing.assist.addAsEstimate')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

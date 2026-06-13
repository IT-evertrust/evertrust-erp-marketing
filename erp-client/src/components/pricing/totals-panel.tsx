'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { PricingSignal, TenderPricingDto } from '@evertrust/shared';
import { useSetMargin } from '@/hooks/use-pricing';
import { Can } from '@/components/auth/can';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import {
  PRICING_STATUS_BADGE_CLASS,
  SIGNAL_TEXT_CLASS,
  formatMoney,
} from '@/lib/pricing-format';
import { FinalizeDialog } from './finalize-dialog';

// The order signals are shown in the summary (best evidence first).
const SIGNAL_ORDER: readonly PricingSignal[] = [
  'REAL_QUOTES',
  'MIXED',
  'ESTIMATE_ONLY',
];

// Totals + risk + finalize panel. Shows subtotal, an editable margin % (PUT on
// blur/Enter, pricing:write), the computed final price, the high-risk banner
// (with reasons), the per-signal histogram, and the Finalize action
// (pricing:approve) behind a confirm dialog.
export function TotalsPanel({
  tenderId,
  pricing,
}: {
  tenderId: string;
  pricing: TenderPricingDto;
}) {
  const t = useTranslations('tenders');
  const isFinal = pricing.status === 'FINAL';

  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          {t('pricing.totals.title')}
          <Badge
            variant="outline"
            className={cn('font-medium', PRICING_STATUS_BADGE_CLASS[pricing.status])}
          >
            {t(`pricing.totals.status.${pricing.status}`)}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pricing.highRisk ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>{t('pricing.totals.highRiskTitle')}</AlertTitle>
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

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t('pricing.totals.subtotal')}</span>
          <span className="font-medium tabular-nums">
            {formatMoney(pricing.subtotal, pricing.currency)}
          </span>
        </div>

        <MarginField
          tenderId={tenderId}
          marginPct={pricing.marginPct}
          disabled={isFinal}
        />

        <Separator />

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{t('pricing.totals.finalPrice')}</span>
          <span className="text-lg font-semibold tabular-nums">
            {formatMoney(pricing.finalPrice, pricing.currency)}
          </span>
        </div>
        <p className="-mt-2 text-right text-xs text-muted-foreground">
          {pricing.currency}
        </p>

        <Separator />

        <SignalSummary pricing={pricing} />

        <Separator />

        <Can
          permission="pricing:approve"
          fallback={
            <p className="text-center text-xs text-muted-foreground">
              {t('pricing.totals.finalizeNoPermission')}
            </p>
          }
        >
          <FinalizeDialog tenderId={tenderId} pricing={pricing} />
        </Can>
      </CardContent>
    </Card>
  );
}

// Editable margin %. Local state for the input; the PUT fires on blur or Enter
// (not every keystroke) and only when the value actually changed. The server
// echoes back the recomputed rollup, which the hook seeds into the cache.
function MarginField({
  tenderId,
  marginPct,
  disabled,
}: {
  tenderId: string;
  marginPct: number;
  disabled: boolean;
}) {
  const t = useTranslations('tenders');
  const [value, setValue] = useState(String(marginPct));
  const setMargin = useSetMargin(tenderId);

  // Keep the input in sync if the server value changes underneath us.
  useEffect(() => {
    setValue(String(marginPct));
  }, [marginPct]);

  function commit() {
    const trimmed = value.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      toast.error(t('pricing.totals.marginError'));
      setValue(String(marginPct));
      return;
    }
    if (n === marginPct) return;
    setMargin.mutate(
      { marginPct: n },
      {
        onError: (error) => {
          toast.error(error.message ?? t('pricing.totals.marginUpdateError'));
          setValue(String(marginPct));
        },
      },
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor="margin" className="text-sm text-muted-foreground">
        {t('pricing.totals.marginLabel')}
      </Label>
      <Can
        permission="pricing:write"
        fallback={
          <span className="text-sm font-medium tabular-nums">
            {marginPct}%
          </span>
        }
      >
        <div className="relative w-28">
          <Input
            id="margin"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={value}
            disabled={disabled || setMargin.isPending}
            onChange={(e) => setValue(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="pr-6 text-right tabular-nums"
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm text-muted-foreground">
            %
          </span>
        </div>
      </Can>
    </div>
  );
}

// Per-signal histogram (REAL_QUOTES / MIXED / ESTIMATE_ONLY counts), color-coded
// to match the RYG mapping.
function SignalSummary({ pricing }: { pricing: TenderPricingDto }) {
  const t = useTranslations('tenders');
  return (
    <div className="grid grid-cols-3 gap-2">
      {SIGNAL_ORDER.map((signal) => (
        <div
          key={signal}
          className="rounded-md border bg-muted/30 px-2 py-2 text-center"
        >
          <div
            className={cn(
              'text-lg font-semibold tabular-nums',
              SIGNAL_TEXT_CLASS[signal],
            )}
          >
            {pricing.signalCounts[signal]}
          </div>
          <div className="text-[11px] leading-tight text-muted-foreground">
            {t(`pricing.signal.${signal}`)}
          </div>
        </div>
      ))}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { useTender } from '@/hooks/use-tenders';
import { useTenderPricing } from '@/hooks/use-pricing';
import { Can } from '@/components/auth/can';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/tenders/status-badge';
import { LineItemsTable } from './line-items-table';
import { TotalsPanel } from './totals-panel';
import { AddLineDialog } from './add-line-dialog';
import { SendRfqDialog } from './send-rfq-dialog';
import { RfqHistory } from './rfq-history';

// Phase 5a pricing workbench: the focused LV-pricing surface for a tender. One
// pricing query drives BOTH the line-items table (per-line engine suggestion) and
// the totals panel (subtotal/margin/finalPrice/risk/signals/finalize), so the two
// can never disagree. Page-level guard is pricing:read (see the route).
export function PricingWorkbench({ tenderId }: { tenderId: string }) {
  const t = useTranslations('tenders');
  const tender = useTender(tenderId);
  const pricing = useTenderPricing(tenderId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <Link
        href={`/tenders/${tenderId}`}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {t('pricing.back')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-3">
            {tender.data ? (
              <StatusBadge status={tender.data.status} className="text-sm" />
            ) : null}
            {tender.data ? (
              <span className="font-mono text-xs text-muted-foreground">
                {tender.data.vergabeId}
              </span>
            ) : null}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('pricing.title')}
          </h1>
          {tender.data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {tender.data.title}
            </p>
          ) : null}
        </div>
      </div>

      {pricing.isError ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>{t('pricing.loadError')}</CardTitle>
            <CardDescription>
              {pricing.error.status === 404
                ? t('pricing.notFound')
                : pricing.error.message}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : pricing.isLoading || !pricing.data ? (
        <Skeleton className="h-96 w-full rounded-lg" />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">{t('pricing.lines.title')}</CardTitle>
                <CardDescription>
                  {t('pricing.lines.description')}
                </CardDescription>
                <Can permission="tenders:write">
                  <CardAction>
                    <AddLineDialog tenderId={tenderId} />
                  </CardAction>
                </Can>
              </CardHeader>
              <CardContent>
                <LineItemsTable
                  tenderId={tenderId}
                  lines={pricing.data.lines}
                  currency={pricing.data.currency}
                />
              </CardContent>
            </Card>

            {/* Phase 5c — Hermes supplier RFQ: request quotes + dispatch history. */}
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-base">{t('pricing.rfq.title')}</CardTitle>
                <CardDescription>
                  {t('pricing.rfq.description')}
                </CardDescription>
                <Can permission="pricing:write">
                  <CardAction>
                    <SendRfqDialog tenderId={tenderId} lines={pricing.data.lines} />
                  </CardAction>
                </Can>
              </CardHeader>
              <CardContent>
                <RfqHistory tenderId={tenderId} />
              </CardContent>
            </Card>
          </div>

          <TotalsPanel tenderId={tenderId} pricing={pricing.data} />
        </div>
      )}
    </div>
  );
}

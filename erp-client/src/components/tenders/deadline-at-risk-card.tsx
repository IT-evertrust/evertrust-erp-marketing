'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlarmClock, ArrowUpRight } from 'lucide-react';
import { useDeadlineRisk } from '@/hooks/use-tenders';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from './status-badge';
import { DeadlineRiskBadge } from './deadline-risk-badge';

// Phase 6 (R31): the "deadline at risk" dashboard frame. Lists open tenders inside
// the T-2 submission window (or overdue), most urgent first, each tagged with its
// escalation target (the role tier n8n routes to). Reads GET /tenders/deadline-risk
// — the SAME deterministic computation n8n polls, so the human view and the
// automated escalation can't disagree.
export function DeadlineAtRiskCard() {
  const t = useTranslations('tenders');
  const atRisk = useDeadlineRisk();

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlarmClock className="size-4 text-amber-500" />
          {t('deadlineRisk.title')}
        </CardTitle>
        <CardDescription>
          {t('deadlineRisk.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {atRisk.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : atRisk.isError ? (
          <p className="text-sm text-destructive">
            {t('deadlineRisk.loadError', { detail: atRisk.error.message })}
          </p>
        ) : atRisk.data && atRisk.data.length > 0 ? (
          <ul className="divide-y divide-border">
            {atRisk.data.map(({ tender, risk }) => (
              <li
                key={tender.id}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    href={`/tenders/${tender.id}`}
                    className="truncate text-sm font-medium hover:underline"
                    title={tender.title}
                  >
                    {tender.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={tender.status} />
                    <DeadlineRiskBadge risk={risk} />
                    <Badge variant="outline" className="font-mono text-xs">
                      {t('deadlineRisk.escalate', { target: risk.escalateTo })}
                    </Badge>
                  </div>
                </div>
                <Link
                  href={`/tenders/${tender.id}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={t('deadlineRisk.openAria', { title: tender.title })}
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('deadlineRisk.empty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

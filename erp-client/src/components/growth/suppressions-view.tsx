'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ShieldOff, Undo2 } from 'lucide-react';
import type { SuppressionListItemDto } from '@evertrust/shared';
import { useDeleteSuppression, useSuppressions } from '@/hooks/use-suppressions';
import { Can } from '@/components/auth/can';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { ConfirmButton } from '@/components/common/confirm-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/tender-format';

// Suppressions (the org do-not-contact list). Un-suppress is confirm-gated and
// optimistic (DELETE /suppressions/:id). All data is real (GET /suppressions).
export function SuppressionsView() {
  const t = useTranslations('marketing');
  const q = useSuppressions();
  const list = q.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('suppressions.title')}
        description={t('suppressions.description')}
      />

      {q.isLoading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : q.isError ? (
        <p className="text-sm text-destructive">
          {t('suppressions.loadError', { message: q.error.message })}
        </p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ShieldOff />}
          title={t('suppressions.emptyTitle')}
          description={t('suppressions.emptyDescription')}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('suppressions.colEmail')}</TableHead>
                <TableHead>{t('suppressions.colReason')}</TableHead>
                <TableHead>{t('suppressions.colAdded')}</TableHead>
                <TableHead className="w-px text-right">{t('suppressions.colAction')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => (
                <SuppressionRow key={s.id} suppression={s} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function SuppressionRow({
  suppression: s,
}: {
  suppression: SuppressionListItemDto;
}) {
  const t = useTranslations('marketing');
  const del = useDeleteSuppression();

  function onUnsuppress() {
    del.mutate(s.id, {
      onSuccess: () => toast.success(t('suppressions.unsuppressed', { email: s.email })),
      onError: (e) => toast.error(e.message ?? t('suppressions.unsuppressError')),
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{s.email}</TableCell>
      <TableCell className="text-muted-foreground">{s.reason || '—'}</TableCell>
      <TableCell className="tabular-nums text-muted-foreground">
        {formatDateTime(s.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <Can
          permission="campaigns:write"
          fallback={<span className="text-xs text-muted-foreground">—</span>}
        >
          <ConfirmButton
            trigger={
              <Button size="sm" variant="outline" disabled={del.isPending}>
                <Undo2 />
                {t('suppressions.unsuppress')}
              </Button>
            }
            title={t('suppressions.confirmTitle', { email: s.email })}
            description={t('suppressions.confirmDescription')}
            confirmLabel={t('suppressions.unsuppress')}
            pending={del.isPending}
            onConfirm={onUnsuppress}
          />
        </Can>
      </TableCell>
    </TableRow>
  );
}

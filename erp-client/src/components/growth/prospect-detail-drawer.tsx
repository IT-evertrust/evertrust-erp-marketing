'use client';

import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import type { ProspectStatus } from '@evertrust/shared';
import { toast } from 'sonner';
import { useProspectDetail, useUpdateProspectStatus } from '@/hooks/use-prospects';
import { Can } from '@/components/auth/can';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { formatDateTime } from '@/lib/tender-format';
import {
  PROSPECT_STATUS_CLASS,
  PROSPECT_STATUS_ORDER,
} from '@/lib/growth-format';
import { OutreachThread } from './outreach-thread';

// Review one prospect: its fields + resolved names, a write-gated status override,
// and the full conversation timeline. Controlled by `prospectId` (open when
// non-null). Status override hits PATCH /prospects/:id/status.
export function ProspectDetailDrawer({
  prospectId,
  onOpenChange,
}: {
  prospectId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('marketing');
  const q = useProspectDetail(prospectId);
  const setStatus = useUpdateProspectStatus();
  const p = q.data;

  function onStatusChange(next: string) {
    if (!prospectId) return;
    const status = next as ProspectStatus;
    setStatus.mutate(
      { id: prospectId, patch: { status } },
      {
        onSuccess: () =>
          toast.success(t('prospects.statusSet', { status: t(`status.${status}`) })),
        onError: (e) => toast.error(e.message ?? t('prospects.statusError')),
      },
    );
  }

  return (
    <Dialog open={!!prospectId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {q.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-1/2" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : q.isError ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('prospects.loadErrorTitle')}</DialogTitle>
              <DialogDescription>
                {q.error.status === 404
                  ? t('prospects.notFound')
                  : q.error.message}
              </DialogDescription>
            </DialogHeader>
          </>
        ) : p ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {p.companyName || p.email}
                <Badge
                  variant="outline"
                  className={PROSPECT_STATUS_CLASS[p.status]}
                >
                  {t(`status.${p.status}`)}
                </Badge>
                {p.emailVerified ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400"
                  >
                    {t('prospects.verified')}
                  </Badge>
                ) : null}
              </DialogTitle>
              <DialogDescription>{p.email}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label={t('prospects.field.campaign')} value={p.campaignName} />
              <Field label={t('prospects.field.nicheTarget')} value={p.nicheTargetName} />
              <Field label={t('prospects.field.website')} value={p.website} />
              <Field
                label={t('prospects.field.location')}
                value={[p.city, p.country].filter(Boolean).join(', ') || null}
              />
              <Field label={t('prospects.field.followups')} value={String(p.followupCount)} />
              <Field
                label={t('prospects.field.lastContacted')}
                value={p.lastContactedAt ? formatDateTime(p.lastContactedAt) : null}
              />
              <Field
                label={t('prospects.field.snoozeUntil')}
                value={p.snoozeUntil ? formatDateTime(p.snoozeUntil) : null}
              />
              <Field label={t('prospects.field.detected')} value={formatDateTime(p.createdAt)} />
            </dl>

            {p.sourceUrl ? (
              <a
                href={p.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-fit text-sm text-sky-400 hover:underline"
              >
                {t('prospects.sourcePage')}
              </a>
            ) : null}

            <Can permission="campaigns:write">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t('prospects.statusLabel')}</span>
                <Select
                  value={p.status}
                  onValueChange={onStatusChange}
                  disabled={setStatus.isPending}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROSPECT_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {setStatus.isPending ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : null}
              </div>
            </Can>

            <Separator />

            <div className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                {t('prospects.conversation')}
              </span>
              <OutreachThread prospectId={p.id} />
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate">{value || '—'}</dd>
    </div>
  );
}

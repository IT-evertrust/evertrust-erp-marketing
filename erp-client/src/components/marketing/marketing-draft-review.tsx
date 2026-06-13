'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import type { MarketingDraftDto } from '@evertrust/shared';
import {
  useMarketingDrafts,
  useScanLeads,
  useSendDraft,
} from '@/hooks/use-marketing';
import { Can } from '@/components/auth/can';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// RAG Draft Review — the EVERTRUST - RAG AGENT workflow drafts replies to
// "Unsure" leads (grounded in a knowledge file) and saves a Gmail draft "Do Not
// Send". Here a human reviews/edits and approves; on send, n8n sends the final
// text, deletes the stale draft and marks the row SENT. "Sync from leads" kicks
// the RAG Agent to scan every campaign's leads sheet for unsure rows. All data
// is REAL (via /marketing/drafts, /marketing/drafts/send, /marketing/drafts/scan).

const AREA_CLASS: Record<string, string> = {
  finance: 'bg-sky-500/15 text-sky-500',
  technical: 'bg-violet-500/15 text-violet-500',
  timeline: 'bg-amber-500/15 text-amber-500',
  pricing: 'bg-sky-500/15 text-sky-500',
  legal: 'bg-rose-500/15 text-rose-500',
};
function areaClass(area: string | null) {
  return (area && AREA_CLASS[area.toLowerCase()]) || 'bg-muted text-muted-foreground';
}
function keyOf(d: MarketingDraftDto, i: number) {
  return d.draftId ?? d.clientEmail ?? `row-${i}`;
}

export function MarketingDraftReview() {
  const t = useTranslations('marketing');
  const drafts = useMarketingDrafts();
  const send = useSendDraft();
  const scan = useScanLeads();
  const [selected, setSelected] = useState<string | null>(null);

  // Subject/body are edited in place; refs read the final values on send. The
  // `key` on the inputs resets them whenever the selected draft changes.
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const list = drafts.data?.drafts ?? [];

  function onScan() {
    scan.mutate(undefined, {
      onSuccess: (r) => toast.success(r.message),
      onError: (e) => toast.error(e.message),
    });
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {t('draftReview.heading')}
      </span>
      <Can permission="campaigns:write">
        <Button
          variant="outline"
          size="sm"
          onClick={onScan}
          disabled={scan.isPending}
        >
          <RefreshCw className={cn('size-4', scan.isPending && 'animate-spin')} />
          {scan.isPending ? t('draftReview.syncing') : t('draftReview.sync')}
        </Button>
      </Can>
    </div>
  );

  function renderBody() {
    if (drafts.isLoading) {
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-[260px] w-full rounded-xl" />
          <Skeleton className="h-[420px] w-full rounded-xl" />
        </div>
      );
    }
    if (drafts.isError) {
      return (
        <Card className="p-6 text-sm text-muted-foreground">
          {t('draftReview.loadError', { message: drafts.error.message })}
        </Card>
      );
    }
    if (drafts.data && !drafts.data.configured) {
      return (
        <Card className="p-6 text-sm text-muted-foreground">
          {t.rich('draftReview.notConnected', {
            code: (chunks) => <code>{chunks}</code>,
          })}
        </Card>
      );
    }
    if (list.length === 0) {
      return (
        <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <span className="text-2xl">✓</span>
          {t.rich('draftReview.empty', {
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </Card>
      );
    }

    const curKey = selected ?? keyOf(list[0]!, 0);
    const idx = Math.max(
      0,
      list.findIndex((d, i) => keyOf(d, i) === curKey),
    );
    const d = list[idx]!;
    const sending = send.isPending;

    function onSend() {
      if (!d.draftId || !d.clientEmail) {
        toast.error(t('draftReview.noDraftId'));
        return;
      }
      send.mutate(
        {
          draftId: d.draftId,
          to: d.clientEmail,
          subject: subjectRef.current?.value ?? d.subject ?? '',
          body: bodyRef.current?.value ?? d.body ?? '',
          threadId: d.threadId ?? undefined,
          source: d.source ?? undefined,
        },
        {
          onSuccess: (r) => {
            if (r.ok) {
              toast.success(
                t('draftReview.sent', { target: d.company ?? d.clientEmail ?? '' }),
              );
              setSelected(null);
            } else {
              toast.error(r.error ?? t('draftReview.sendFailed'));
            }
          },
          onError: (e) => toast.error(e.message),
        },
      );
    }

    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* queue */}
        <Card className="h-fit overflow-hidden p-0">
          <div className="flex items-center justify-between border-b px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>{t('draftReview.awaitingReview')}</span>
            <span className="text-amber-500">{list.length}</span>
          </div>
          {list.map((dr, i) => {
            const k = keyOf(dr, i);
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                className={cn(
                  'block w-full border-b px-4 py-3 text-left transition-colors hover:bg-muted/50',
                  k === curKey && 'bg-sky-500/10 shadow-[inset_3px_0_0_#0ea5e9]',
                )}
              >
                <div className="text-[13px] font-semibold">
                  {dr.company ?? dr.clientEmail ?? t('draftReview.unknown')}
                </div>
                {dr.leadQuestion ? (
                  <div className="truncate text-[11.8px] text-muted-foreground">
                    &ldquo;{dr.leadQuestion}&rdquo;
                  </div>
                ) : null}
                <div className="mt-1.5 flex items-center gap-2">
                  {dr.unsureArea ? (
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10.5px] font-bold capitalize',
                        areaClass(dr.unsureArea),
                      )}
                    >
                      {dr.unsureArea}
                    </span>
                  ) : null}
                  {!dr.sendable ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                      {t('draftReview.notSendable')}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </Card>

        {/* detail */}
        <Card className="p-5">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-semibold">
              {d.company ?? d.clientEmail ?? t('draftReview.unknown')}
            </h2>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-500">
              {t('draftReview.gmailDraftBadge')}
            </span>
            {d.source ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {d.source}
              </span>
            ) : null}
          </div>
          <div className="mb-3 text-[12.5px] text-muted-foreground">
            {d.clientEmail ?? '—'}
            {d.unsureArea ? (
              <>
                {' '}
                · {t('draftReview.unsureAreaLabel')}:{' '}
                <span className="font-semibold capitalize text-foreground">
                  {d.unsureArea}
                </span>
              </>
            ) : null}
          </div>

          {d.leadQuestion || d.unsureSection || d.explanation ? (
            <>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('draftReview.contextHeading')}
              </p>
              <div className="rounded-xl border bg-muted/30 px-4 py-3">
                {d.leadQuestion ? (
                  <p className="border-l-2 border-sky-500 pl-2.5 text-[13px] italic text-foreground/80">
                    &ldquo;{d.leadQuestion}&rdquo;
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
                  {d.unsureSection ? (
                    <>
                      <div className="text-muted-foreground">
                        {t('draftReview.unsureAbout')}
                      </div>
                      <div>{d.unsureSection}</div>
                    </>
                  ) : null}
                  {d.explanation ? (
                    <>
                      <div className="text-muted-foreground">
                        {t('draftReview.why')}
                      </div>
                      <div>{d.explanation}</div>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <p className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('draftReview.draftedReply')}
          </p>
          <Input
            ref={subjectRef}
            className="mb-2"
            defaultValue={d.subject ?? ''}
            key={`${curKey}-subj`}
            placeholder={t('draftReview.subjectPlaceholder')}
          />
          <Textarea
            ref={bodyRef}
            className="min-h-[200px] whitespace-pre-wrap"
            defaultValue={d.body ?? ''}
            key={`${curKey}-body`}
            placeholder={t('draftReview.bodyPlaceholder')}
          />

          {!d.sendable ? (
            <div className="mt-2.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
              {t('draftReview.notSendableWarning')}
            </div>
          ) : null}

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Can permission="campaigns:write">
              <Button onClick={onSend} disabled={sending || !d.sendable}>
                {sending ? t('draftReview.sending') : t('draftReview.approveSend')}
              </Button>
            </Can>
            <span className="ml-auto text-[11.5px] text-muted-foreground">
              {t('draftReview.sendHint')}
            </span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {header}
      {renderBody()}
    </div>
  );
}

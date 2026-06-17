'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  Copy,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  UserSearch,
} from 'lucide-react';
import type { EngageReplyDto, ReplyVerdict } from '@evertrust/shared';
import {
  useEngageReplies,
  useRedraftReply,
  useScanReplies,
  useSendReply,
} from '@/hooks/use-engage';
import { Can } from '@/components/auth/can';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { AccountBar } from '@/components/rean/account-bar';
import { Board, BoardColumn, type BoardTone } from '@/components/rean/board';
import { ToneBadge, type ToneName } from '@/components/rean/tone-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { OutreachThread } from './outreach-thread';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// Engage — Reply triage. The ERP-direct Gmail reply pipeline (no n8n): the API
// reads recent inbound replies straight from the org's connected default mailbox,
// classifies + drafts via Claude. Reframed as the mockup's "Reply Sorter" board:
// an AccountBar (Gmail) on top + three triage columns (Interested / Unsure /
// Not interested). Per reply: company, subject/snippet, the classification, the
// suggested reply (copy or edit + approve & send), and an expandable thread for
// matched prospects.

// The three triage buckets the mockup shows, in column order. Every reply's
// classification (a ReplyVerdict) maps to exactly one column.
type TriageBucket = 'interested' | 'unsure' | 'notInterested';

const BUCKET_OF: Record<ReplyVerdict, TriageBucket> = {
  INTERESTED: 'interested',
  MEETING_REQUEST: 'interested',
  UNSURE: 'unsure',
  SNOOZE: 'unsure',
  NOT_INTERESTED: 'notInterested',
  AUTO_REPLY: 'notInterested',
  BOUNCE: 'notInterested',
};

const BUCKET_ORDER: readonly TriageBucket[] = [
  'interested',
  'unsure',
  'notInterested',
];

const BUCKET_TONE: Record<TriageBucket, BoardTone> = {
  interested: 'emerald',
  unsure: 'amber',
  notInterested: 'rose',
};

// The per-classification pill tone (re-uses the shared ToneBadge palette):
// INTERESTED → emerald, UNSURE → amber, NOT_INTERESTED → rose.
const VERDICT_TONE: Record<ReplyVerdict, ToneName> = {
  INTERESTED: 'emerald',
  MEETING_REQUEST: 'emerald',
  SNOOZE: 'amber',
  UNSURE: 'amber',
  NOT_INTERESTED: 'rose',
  AUTO_REPLY: 'muted',
  BOUNCE: 'rose',
};

export function ReplyDraftsView() {
  const t = useTranslations('engage');
  const q = useEngageReplies();
  const scan = useScanReplies();
  const [openProspect, setOpenProspect] = useState<string | null>(null);

  const data = q.data;
  const configured = data?.configured ?? false;
  const accountEmail = data?.account?.email ?? null;
  const replies = useMemo(() => data?.replies ?? [], [data]);

  const buckets = useMemo(() => {
    const map: Record<TriageBucket, EngageReplyDto[]> = {
      interested: [],
      unsure: [],
      notInterested: [],
    };
    for (const r of replies) map[BUCKET_OF[r.classification]].push(r);
    return map;
  }, [replies]);

  const interestedCount = buckets.interested.length;

  const scanButton = (
    <Can permission="campaigns:write">
      <Button
        size="sm"
        variant="outline"
        onClick={() => scan.mutate()}
        disabled={scan.isPending}
      >
        {scan.isPending ? (
          <Loader2 className="animate-spin" />
        ) : (
          <RefreshCw />
        )}
        {scan.isPending ? t('scan.scanning') : t('scan.button')}
      </Button>
    </Can>
  );

  const accountBar = (
    <AccountBar
      service={t('account.service')}
      connected={configured}
      mailboxes={
        configured && accountEmail
          ? [{ value: accountEmail, label: <span>{accountEmail}</span> }]
          : []
      }
      value={accountEmail ?? undefined}
      stats={
        <span className="flex items-center gap-3">
          <span>
            {configured
              ? t('account.stats', {
                  replies: replies.length,
                  interested: interestedCount,
                })
              : t('account.connectHint')}
          </span>
          {scanButton}
        </span>
      }
    />
  );

  return (
    <div className="flex flex-col gap-6 font-sans">
      <PageHeader title={t('header.title')} description={t('header.description')} />

      {accountBar}

      {q.isLoading ? (
        <Board>
          {BUCKET_ORDER.map((b) => (
            <BoardColumn key={b} title={t(`triage.${b}`)} tone={BUCKET_TONE[b]}>
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </BoardColumn>
          ))}
        </Board>
      ) : q.isError ? (
        <Card className="p-6 text-sm text-destructive">
          {t('drafts.loadError', { message: q.error.message })}
        </Card>
      ) : !configured ? (
        <EmptyState
          icon={<Inbox />}
          title={t('connect.title')}
          description={t('connect.description')}
          action={
            <Button asChild size="sm" variant="outline">
              <a href="/settings/configuration">{t('connect.cta')}</a>
            </Button>
          }
        />
      ) : replies.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t('drafts.emptyTitle')}
          description={t('drafts.emptyScanHint')}
          action={scanButton}
        />
      ) : (
        <Board>
          {BUCKET_ORDER.map((b) => (
            <BoardColumn
              key={b}
              title={t(`triage.${b}`)}
              tone={BUCKET_TONE[b]}
              count={buckets[b].length}
            >
              {buckets[b].length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                  {t('triage.emptyColumn')}
                </p>
              ) : (
                buckets[b].map((r) => (
                  <ReplyCard
                    key={r.id}
                    reply={r}
                    onOpenProspect={
                      r.prospectId
                        ? () => setOpenProspect(r.prospectId)
                        : undefined
                    }
                  />
                ))
              )}
            </BoardColumn>
          ))}
        </Board>
      )}

      <ProspectDetailDrawer
        prospectId={openProspect}
        onOpenChange={(open) => {
          if (!open) setOpenProspect(null);
        }}
      />
    </div>
  );
}

function ReplyCard({
  reply: r,
  onOpenProspect,
}: {
  reply: EngageReplyDto;
  // Undefined when the reply has no matched prospect — the open-prospect /
  // conversation actions are then hidden.
  onOpenProspect?: () => void;
}) {
  const t = useTranslations('engage');
  const send = useSendReply();
  const redraft = useRedraftReply();
  const [expanded, setExpanded] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [draft, setDraft] = useState(r.suggestedReply ?? '');

  const hasReply = r.suggestedReply != null && r.suggestedReply.length > 0;

  async function copyReply() {
    if (!hasReply) return;
    try {
      await navigator.clipboard.writeText(r.suggestedReply ?? '');
      toast.success(t('drafts.copied'));
    } catch {
      toast.error(t('drafts.copyError'));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">
          {r.company ?? r.fromEmail}
        </span>
        <ToneBadge
          tone={VERDICT_TONE[r.classification]}
          className="shrink-0 text-[10px]"
        >
          {t(`verdict.${r.classification}`)}
        </ToneBadge>
      </div>

      <p className="truncate text-[11px] text-muted-foreground">{r.fromEmail}</p>

      {r.subject ? (
        <p className="truncate text-[11.5px] font-medium">{r.subject}</p>
      ) : null}

      {r.snippet ? (
        <p
          className={cn(
            'whitespace-pre-wrap rounded-md border bg-background/50 p-2.5 text-[12px] leading-snug',
            !expanded && 'line-clamp-3',
          )}
        >
          {r.snippet}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {formatDateTime(r.receivedAt)}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((s) => !s)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
          />
        </button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2 border-t pt-2">
          {r.reason ? (
            <p className="text-[11px] text-muted-foreground">{r.reason}</p>
          ) : null}

          {hasReply ? (
            <div className="flex flex-col gap-2">
              <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {t('send.label')}
              </p>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={5}
                className="text-[12px] leading-snug"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <Can permission="campaigns:write">
                  <Button
                    size="sm"
                    onClick={() => send.mutate({ id: r.id, text: draft })}
                    disabled={send.isPending || draft.trim().length === 0}
                  >
                    {send.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Send />
                    )}
                    {t('send.button')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => redraft.mutate({ id: r.id })}
                    disabled={redraft.isPending}
                  >
                    {redraft.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <RefreshCw />
                    )}
                    {t('redraft.button')}
                  </Button>
                </Can>
                <Button size="sm" variant="outline" onClick={copyReply}>
                  <Copy />
                  {t('drafts.copyDraft')}
                </Button>
              </div>
            </div>
          ) : null}

          {onOpenProspect ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="outline" onClick={onOpenProspect}>
                <UserSearch />
                {t('drafts.openProspect')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowThread((s) => !s)}
                aria-expanded={showThread}
              >
                <MessageSquare />
                {showThread
                  ? t('drafts.hideConversation')
                  : t('drafts.showConversation')}
              </Button>
            </div>
          ) : null}

          {showThread && r.prospectId ? (
            <div className="border-t pt-2">
              <OutreachThread prospectId={r.prospectId} enabled={showThread} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

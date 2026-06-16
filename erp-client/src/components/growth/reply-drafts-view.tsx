'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronDown,
  Copy,
  Inbox,
  MessageSquare,
  UserSearch,
} from 'lucide-react';
import type { ReplyDraftDto, ReplyVerdict } from '@evertrust/shared';
import { useReplyDrafts } from '@/hooks/use-reply-drafts';
import { useGoogleAccounts } from '@/hooks/use-arsenal';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { AccountBar } from '@/components/rean/account-bar';
import { Board, BoardColumn, type BoardTone } from '@/components/rean/board';
import { ToneBadge, type ToneName } from '@/components/rean/tone-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { OutreachThread } from './outreach-thread';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// Engage — Reply triage. The RAG reply-classification queue (rows WITH a
// suggestedReply) reframed as the mockup's "Reply Sorter" board: an AccountBar
// (Gmail) on top + three triage columns (Interested / Unsure / Not interested).
// Per draft: prospect, verdict, the suggested reply, and an expandable thread.
// Actions are copy-to-clipboard + open-prospect ONLY — there is no server
// "mark handled" endpoint, so nothing here fabricates one.

// The three triage buckets the mockup shows, in column order. Every ReplyVerdict
// maps to exactly one — the AI verdict drives which column a draft lands in.
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

// The per-verdict pill tone (re-uses the shared ToneBadge palette).
const VERDICT_TONE: Record<ReplyVerdict, ToneName> = {
  INTERESTED: 'emerald',
  MEETING_REQUEST: 'emerald',
  SNOOZE: 'amber',
  UNSURE: 'amber',
  NOT_INTERESTED: 'muted',
  AUTO_REPLY: 'muted',
  BOUNCE: 'rose',
};

export function ReplyDraftsView() {
  const t = useTranslations('engage');
  const q = useReplyDrafts();
  // The org's connected Gmail account drives the AccountBar. It's admin:config
  // server-side, so a non-admin / unset org gets an error or empty list — both
  // collapse to the "no mailbox connected" empty state, never a thrown page.
  const google = useGoogleAccounts();
  const [openProspect, setOpenProspect] = useState<string | null>(null);

  const drafts = useMemo(() => q.data ?? [], [q.data]);

  const buckets = useMemo(() => {
    const map: Record<TriageBucket, ReplyDraftDto[]> = {
      interested: [],
      unsure: [],
      notInterested: [],
    };
    for (const d of drafts) map[BUCKET_OF[d.verdict]].push(d);
    return map;
  }, [drafts]);

  const interestedCount = buckets.interested.length;

  // Resolve the default Gmail mailbox (org_config default pointer, else the first
  // CONNECTED account). No account → the bar renders disconnected.
  const gmailAccounts = (google.data ?? []).filter(
    (a) => a.status === 'CONNECTED',
  );
  const gmailDefault =
    gmailAccounts.find((a) => a.isDefaultGmail) ?? gmailAccounts[0] ?? null;
  const gmailConnected = Boolean(gmailDefault);

  const accountBar = (
    <AccountBar
      service={t('account.service')}
      connected={gmailConnected}
      mailboxes={
        gmailDefault
          ? [
              {
                value: gmailDefault.id,
                label: (
                  <span>
                    {gmailDefault.email}
                    {gmailDefault.isDefaultGmail ? (
                      <span className="ml-1.5 text-muted-foreground">
                        · {t('account.defaultSuffix')}
                      </span>
                    ) : null}
                  </span>
                ),
              },
            ]
          : []
      }
      value={gmailDefault?.id}
      stats={
        gmailConnected
          ? t('account.stats', {
              drafts: drafts.length,
              interested: interestedCount,
            })
          : t('account.connectHint')
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
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title={t('drafts.emptyTitle')}
          description={t('drafts.emptyDescription')}
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
                buckets[b].map((d) => (
                  <DraftCard
                    key={d.id}
                    draft={d}
                    onOpenProspect={() => setOpenProspect(d.prospectId)}
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

function DraftCard({
  draft: d,
  onOpenProspect,
}: {
  draft: ReplyDraftDto;
  onOpenProspect: () => void;
}) {
  const t = useTranslations('engage');
  const [expanded, setExpanded] = useState(false);
  const [showThread, setShowThread] = useState(false);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(d.suggestedReply);
      toast.success(t('drafts.copied'));
    } catch {
      toast.error(t('drafts.copyError'));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold">
          {d.prospectCompanyName || d.prospectEmail}
        </span>
        <ToneBadge tone={VERDICT_TONE[d.verdict]} className="shrink-0 text-[10px]">
          {t(`verdict.${d.verdict}`)}
        </ToneBadge>
      </div>

      <p className="truncate text-[11px] text-muted-foreground">
        {d.prospectEmail}
      </p>

      {d.latestVerdict !== d.verdict ? (
        <ToneBadge tone="amber" className="w-fit text-[10px]">
          {t('drafts.now', { verdict: t(`verdict.${d.latestVerdict}`) })}
        </ToneBadge>
      ) : null}

      <p
        className={cn(
          'whitespace-pre-wrap rounded-md border bg-background/50 p-2.5 text-[12px] leading-snug',
          !expanded && 'line-clamp-3',
        )}
      >
        {d.suggestedReply}
      </p>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] tabular-nums text-muted-foreground">
          {formatDateTime(d.createdAt)}
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
          {d.model ? (
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {d.model}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={copyDraft}>
              <Copy />
              {t('drafts.copyDraft')}
            </Button>
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

          {showThread ? (
            <div className="border-t pt-2">
              <OutreachThread prospectId={d.prospectId} enabled={showThread} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

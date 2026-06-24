'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Copy,
  Inbox,
  Loader2,
  Mail,
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
import { ToneBadge, type ToneName } from '@/components/rean/tone-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { OutreachThread } from './outreach-thread';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// Engage — Reply INBOX (master-detail). The ERP-direct Gmail reply pipeline (no
// n8n): the API reads recent inbound replies straight from the org's connected
// default mailbox, classifies + drafts via Claude. Reframed as a two-pane inbox:
// an AccountBar (Gmail) + "Scan inbox" + a count summary on top, then below a
// LEFT list of replies and a RIGHT reading pane for the selected reply (header,
// body/snippet, the matched-prospect thread, and the editable suggested reply
// with approve & send / regenerate / copy).

// The per-classification pill tone (re-uses the shared ToneBadge palette):
// INTERESTED → emerald, UNSURE → amber, NOT_INTERESTED → rose. `classification`
// is a ReplyVerdict (the Engage UI subsets to the three above, but the contract
// carries the full enum — map every value so a stray verdict never crashes).
const VERDICT_TONE: Record<ReplyVerdict, ToneName> = {
  INTERESTED: 'emerald',
  MEETING_REQUEST: 'emerald',
  SNOOZE: 'amber',
  UNSURE: 'amber',
  NOT_INTERESTED: 'rose',
  AUTO_REPLY: 'muted',
  BOUNCE: 'rose',
};

// The left-pane filter chips. 'all' shows everything; the rest map a chip to the
// set of verdicts it admits (so the three triage buckets stay meaningful even
// though `classification` is the full ReplyVerdict enum).
type FilterKey = 'all' | 'interested' | 'unsure' | 'notInterested';

const FILTER_ORDER: readonly FilterKey[] = [
  'all',
  'interested',
  'unsure',
  'notInterested',
];

const FILTER_VERDICTS: Record<Exclude<FilterKey, 'all'>, ReplyVerdict[]> = {
  interested: ['INTERESTED', 'MEETING_REQUEST'],
  unsure: ['UNSURE', 'SNOOZE'],
  notInterested: ['NOT_INTERESTED', 'AUTO_REPLY', 'BOUNCE'],
};

function matchesFilter(reply: EngageReplyDto, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  return FILTER_VERDICTS[filter].includes(reply.classification);
}

export function ReplyDraftsView() {
  const t = useTranslations('engage');
  // Legacy prospect-centric Engage view (only routed from the quarantined advanced/
  // area). The hooks now require an accountId; this view has no mailbox selector, so
  // it passes undefined → the org default mailbox.
  const q = useEngageReplies(undefined);
  const scan = useScanReplies();
  const [openProspect, setOpenProspect] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  const data = q.data;
  const configured = data?.configured ?? false;
  const accountEmail = data?.account?.email ?? null;
  const replies = useMemo(() => data?.replies ?? [], [data]);

  const interestedCount = useMemo(
    () => replies.filter((r) => matchesFilter(r, 'interested')).length,
    [replies],
  );

  const filtered = useMemo(
    () => replies.filter((r) => matchesFilter(r, filter)),
    [replies, filter],
  );

  // Keep a valid selection: default to the first reply, and re-point if the
  // current one drops out of the list (e.g. after a send) or the filter hides it.
  useEffect(() => {
    const first = filtered[0];
    if (!first) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!filtered.some((r) => r.id === selectedId)) {
      setSelectedId(first.id);
    }
  }, [filtered, selectedId]);

  const selected = useMemo(
    () => replies.find((r) => r.id === selectedId) ?? null,
    [replies, selectedId],
  );

  const scanButton = (
    <Can permission="campaigns:write">
      <Button
        size="sm"
        variant="outline"
        onClick={() => scan.mutate(undefined)}
        disabled={scan.isPending}
      >
        {scan.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
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
        <InboxSkeleton />
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
        <div className="flex flex-col gap-4 lg:h-[calc(100vh-18rem)] lg:flex-row lg:gap-5">
          <ReplyList
            replies={filtered}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            filter={filter}
            onFilterChange={setFilter}
          />
          <ReplyReadingPane
            reply={selected}
            onOpenProspect={
              selected?.prospectId
                ? () => setOpenProspect(selected.prospectId)
                : undefined
            }
          />
        </div>
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

// LEFT pane — the email list with optional filter chips. Narrower, own scroll.
function ReplyList({
  replies,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: {
  replies: EngageReplyDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: FilterKey;
  onFilterChange: (filter: FilterKey) => void;
}) {
  const t = useTranslations('engage');

  return (
    <Card className="flex max-h-[60vh] flex-col gap-0 overflow-hidden p-0 lg:max-h-none lg:w-[380px] lg:shrink-0">
      <div className="flex flex-wrap gap-1.5 border-b p-2.5">
        {FILTER_ORDER.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            aria-pressed={filter === f}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
              filter === f
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-transparent text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {replies.length === 0 ? (
          <li className="px-3 py-10 text-center text-xs text-muted-foreground">
            {t('filters.empty')}
          </li>
        ) : (
          replies.map((r) => {
            const active = r.id === selectedId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  aria-current={active}
                  className={cn(
                    'flex w-full flex-col gap-1 border-l-2 border-b px-3 py-2.5 text-left transition-colors',
                    active
                      ? 'border-l-emerald-500 bg-emerald-500/10'
                      : 'border-l-transparent hover:bg-muted/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[12.5px] font-semibold">
                      {r.company ?? r.fromEmail}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        DOT_CLASS[VERDICT_TONE[r.classification]],
                      )}
                    />
                  </div>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {r.subject ?? r.snippet ?? r.fromEmail}
                  </span>
                  <span className="text-[10.5px] tabular-nums text-muted-foreground/80">
                    {formatDateTime(r.receivedAt)}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </Card>
  );
}

// The classification indicator dot, keyed off the same ToneBadge palette.
const DOT_CLASS: Record<ToneName, string> = {
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  muted: 'bg-muted-foreground/40',
};

// RIGHT pane — the reading view for the selected reply. Its own scroll.
function ReplyReadingPane({
  reply: r,
  onOpenProspect,
}: {
  reply: EngageReplyDto | null;
  // Undefined when the reply has no matched prospect — the open-prospect button
  // is then hidden and the thread is replaced by a "not linked" note.
  onOpenProspect?: () => void;
}) {
  const t = useTranslations('engage');
  const send = useSendReply();
  const redraft = useRedraftReply();
  const [draft, setDraft] = useState('');

  // Re-seed the editor whenever the selected reply (or its suggestion) changes.
  useEffect(() => {
    setDraft(r?.suggestedReply ?? '');
  }, [r?.id, r?.suggestedReply]);

  if (!r) {
    return (
      <Card className="flex min-h-[200px] flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 text-center text-muted-foreground">
          <Mail className="size-8 text-muted-foreground/40" />
          <p className="text-sm">{t('inbox.selectPrompt')}</p>
        </div>
      </Card>
    );
  }

  const suggested = r.suggestedReply;
  const hasReply = suggested != null && suggested.length > 0;

  async function copyReply() {
    if (suggested == null) return;
    try {
      await navigator.clipboard.writeText(suggested);
      toast.success(t('drafts.copied'));
    } catch {
      toast.error(t('drafts.copyError'));
    }
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-5">
          {/* Header block */}
          <div className="flex flex-col gap-2 border-b pb-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">
                  {r.company ?? r.fromEmail}
                </p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {r.fromEmail}
                </p>
              </div>
              <ToneBadge tone={VERDICT_TONE[r.classification]} className="shrink-0">
                {t(`verdict.${r.classification}`)}
              </ToneBadge>
            </div>

            {r.subject ? (
              <p className="text-sm font-medium">{r.subject}</p>
            ) : null}

            <p className="text-[11px] tabular-nums text-muted-foreground">
              {formatDateTime(r.receivedAt)}
            </p>

            {r.reason ? (
              <p className="text-[12px] text-muted-foreground">{r.reason}</p>
            ) : null}
          </div>

          {/* Inbound body / snippet */}
          {r.snippet ? (
            <p className="whitespace-pre-wrap rounded-md border bg-background/50 p-3 text-[13px] leading-relaxed">
              {r.snippet}
            </p>
          ) : null}

          {/* The full conversation, when matched to a prospect */}
          {r.prospectId ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('drafts.showConversation')}
              </p>
              <OutreachThread prospectId={r.prospectId} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-[12px] text-muted-foreground">
              {t('inbox.notLinked')}
            </p>
          )}

          {/* Suggested reply editor (or the verdict-only note when undrafted) */}
          {hasReply ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('send.label')}
              </p>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={7}
                className="text-[13px] leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-2">
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
                {onOpenProspect ? (
                  <Button size="sm" variant="ghost" onClick={onOpenProspect}>
                    <UserSearch />
                    {t('drafts.openProspect')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-[12px] text-muted-foreground">
                {t('inbox.noDraft')}
              </p>
              {onOpenProspect ? (
                <div>
                  <Button size="sm" variant="outline" onClick={onOpenProspect}>
                    <UserSearch />
                    {t('drafts.openProspect')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function InboxSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-18rem)] lg:flex-row lg:gap-5">
      <Card className="flex flex-col gap-2 p-3 lg:w-[380px] lg:shrink-0">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </Card>
      <Card className="flex flex-1 flex-col gap-3 p-5">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </Card>
    </div>
  );
}

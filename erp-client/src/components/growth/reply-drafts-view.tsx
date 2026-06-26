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
import { EmptyState } from '@/components/common/empty-state';
import { AccountBar } from '@/components/rean/account-bar';
import { ToneBadge, type ToneName } from '@/components/rean/tone-badge';
import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { OutreachThread } from './outreach-thread';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// Engage — Reply INBOX (master-detail). The ERP-direct Gmail reply pipeline (no
// n8n): the API reads recent inbound replies straight from the org's connected
// default mailbox, classifies + drafts via Claude. Styled to match Kobe's
// minimalist "Reply Sorter" look (GrowthCard framing, monochrome chips,
// uppercase section labels, muted chat bubbles) while keeping every live
// behaviour: the AccountBar (Gmail) mailbox selector + "Scan inbox", a LEFT list
// of triaged replies and a RIGHT reading pane (header, body/snippet, the
// matched-prospect thread, and the editable suggested reply with approve & send /
// re-draft / copy).

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
  const q = useEngageReplies();
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
        onClick={() => scan.mutate()}
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
    <main className="flex flex-col gap-4 px-6 py-5 font-sans">
      {/* "Reply Sorter" tab masthead — mirrors Kobe's engage header. */}
      <div className="border-b border-sidebar-border">
        <span className="mb-[-1px] inline-block border-b-2 border-foreground px-1 py-3 text-[13px] font-bold text-foreground">
          {t('header.title')}
        </span>
      </div>

      <p className="text-[12px] text-muted-foreground">
        {t('header.description')}
      </p>

      {accountBar}

      {q.isLoading ? (
        <InboxSkeleton />
      ) : q.isError ? (
        <GrowthCard title={t('header.title')}>
          <p className="text-sm text-destructive">
            {t('drafts.loadError', { message: q.error.message })}
          </p>
        </GrowthCard>
      ) : !configured ? (
        <EmptyState
          icon={<Inbox />}
          title={t('connect.title')}
          description={t('connect.description')}
          action={
            <Button asChild size="sm" variant="outline">
              <a href="/settings/general">{t('connect.cta')}</a>
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
        <GrowthCard title={t('header.title')}>
          <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-[10px] border border-sidebar-border lg:grid-cols-[320px_1fr]">
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
        </GrowthCard>
      )}

      <ProspectDetailDrawer
        prospectId={openProspect}
        onOpenChange={(open) => {
          if (!open) setOpenProspect(null);
        }}
      />
    </main>
  );
}

// LEFT pane — the email list with filter chips. Kobe's monochrome list: a
// bordered aside, pill filters, rows that highlight with an inset left rule.
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
    <aside className="flex max-h-[60vh] flex-col overflow-hidden border-b border-sidebar-border lg:max-h-none lg:border-b-0 lg:border-r">
      <div className="flex flex-wrap gap-1.5 border-b border-sidebar-border p-3.5">
        {FILTER_ORDER.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onFilterChange(f)}
            aria-pressed={filter === f}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] transition-colors',
              filter === f
                ? 'border-foreground bg-foreground text-background'
                : 'border-sidebar-border text-muted-foreground hover:bg-muted',
            )}
          >
            {t(`filters.${f}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {replies.length === 0 ? (
          <p className="p-6 text-center text-[12.5px] font-bold text-muted-foreground">
            {t('filters.empty')}
          </p>
        ) : (
          replies.map((r) => {
            const active = r.id === selectedId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                aria-current={active}
                className={cn(
                  'block w-full border-b border-sidebar-border px-4 py-3 text-left transition-colors hover:bg-muted',
                  active
                    ? 'bg-muted shadow-[inset_2px_0_0_var(--foreground)]'
                    : 'bg-card',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-bold text-foreground">
                    {r.company ?? r.fromEmail}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {formatDateTime(r.receivedAt)}
                  </span>
                </div>

                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {r.fromEmail}
                </div>

                <div className="mt-2 line-clamp-2 text-[11.5px] text-muted-foreground">
                  {r.subject ?? r.snippet ?? r.fromEmail}
                </div>

                <div className="mt-2">
                  <span
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em]',
                      CHIP_CLASS[VERDICT_TONE[r.classification]],
                    )}
                  >
                    {t(`verdict.${r.classification}`)}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

// The left-list category chip, keyed off the same ToneBadge palette so the list
// and the reading-pane badge stay in lockstep.
const CHIP_CLASS: Record<ToneName, string> = {
  emerald:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  amber:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  rose: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400',
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  violet:
    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
  muted: 'border-sidebar-border bg-muted text-muted-foreground',
};

// RIGHT pane — the reading view for the selected reply. Kobe's detail layout:
// header row + bordered thread + a bordered "AI Reply Draft" editor box.
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
      <section className="flex min-h-[200px] flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-sidebar-border bg-muted px-6 py-8 text-center text-muted-foreground">
          <Mail className="size-8 text-muted-foreground/40" />
          <p className="text-[12.5px] font-bold">{t('inbox.selectPrompt')}</p>
        </div>
      </section>
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
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      {/* Header block */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-foreground">
            {r.company ?? r.fromEmail}
          </div>
          <div className="mt-1 truncate text-[11px] text-muted-foreground">
            {r.fromEmail}
          </div>
          {r.subject ? (
            <div className="mt-1 text-[12.5px] font-bold text-foreground">
              {r.subject}
            </div>
          ) : null}
          <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
            {formatDateTime(r.receivedAt)}
          </div>
          {r.reason ? (
            <p className="mt-1 text-[11.5px] text-muted-foreground">{r.reason}</p>
          ) : null}
        </div>

        <ToneBadge tone={VERDICT_TONE[r.classification]} className="shrink-0">
          {t(`verdict.${r.classification}`)}
        </ToneBadge>
      </div>

      {/* Inbound body / snippet */}
      {r.snippet ? (
        <p className="whitespace-pre-wrap rounded-[10px] border border-sidebar-border bg-muted p-3 text-[12.5px] leading-relaxed text-muted-foreground">
          {r.snippet}
        </p>
      ) : null}

      {/* The full conversation, when matched to a prospect */}
      {r.prospectId ? (
        <div className="flex flex-col gap-2">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            {t('drafts.showConversation')}
          </div>
          <div className="max-h-[260px] overflow-auto rounded-[10px] border border-sidebar-border p-3">
            <OutreachThread prospectId={r.prospectId} />
          </div>
        </div>
      ) : (
        <p className="rounded-[10px] border border-dashed border-sidebar-border bg-muted p-3 text-[11.5px] text-muted-foreground">
          {t('inbox.notLinked')}
        </p>
      )}

      {/* Suggested reply editor (or the verdict-only note when undrafted) */}
      {hasReply ? (
        <div className="overflow-hidden rounded-[10px] border border-sidebar-border bg-card">
          <div className="p-4">
            <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              <LiveDot />
              {t('send.label')}
            </div>

            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              className="resize-none border-sidebar-border bg-muted text-[12.5px] leading-relaxed"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-[10px] border border-dashed border-sidebar-border bg-muted p-4">
          <p className="text-[11.5px] text-muted-foreground">
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
    </section>
  );
}

function InboxSkeleton() {
  return (
    <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-[10px] border border-sidebar-border bg-card lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-2 border-b border-sidebar-border p-3 lg:border-b-0 lg:border-r">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  );
}

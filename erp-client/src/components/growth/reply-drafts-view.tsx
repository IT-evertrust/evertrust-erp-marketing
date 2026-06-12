'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown,
  Copy,
  Inbox,
  MessageSquare,
  UserSearch,
} from 'lucide-react';
import type { ReplyDraftDto } from '@evertrust/shared';
import { useReplyDrafts } from '@/hooks/use-reply-drafts';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { REPLY_VERDICT_CLASS, REPLY_VERDICT_LABEL } from '@/lib/growth-format';
import { OutreachThread } from './outreach-thread';
import { ProspectDetailDrawer } from './prospect-detail-drawer';

// RAG draft review: the reply-classification queue (rows WITH a suggestedReply).
// Per draft: prospect, verdict, the suggested reply, and an expandable thread.
// Actions are copy-to-clipboard + open-prospect ONLY — there is no server
// "mark handled" endpoint, so nothing here fabricates one.
export function ReplyDraftsView() {
  const q = useReplyDrafts();
  const [openProspect, setOpenProspect] = useState<string | null>(null);

  const drafts = q.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reply drafts"
        description="RAG-suggested replies awaiting a human. Copy the draft into your reply, or open the prospect for the full thread."
      />

      {q.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      ) : q.isError ? (
        <Card className="p-6 text-sm text-destructive">
          Could not load reply drafts: {q.error.message}
        </Card>
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No drafts awaiting review"
          description="When the reply classifier drafts a suggested response, it appears here for approval."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              onOpenProspect={() => setOpenProspect(d.prospectId)}
            />
          ))}
        </ul>
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
  const [showThread, setShowThread] = useState(false);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(d.suggestedReply);
      toast.success('Draft copied to clipboard.');
    } catch {
      toast.error('Could not copy — your browser blocked clipboard access.');
    }
  }

  return (
    <li>
      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <span className="min-w-0 truncate font-semibold">
            {d.prospectCompanyName || d.prospectEmail}
          </span>
          <Badge variant="outline" className={REPLY_VERDICT_CLASS[d.verdict]}>
            {REPLY_VERDICT_LABEL[d.verdict]}
          </Badge>
          {d.latestVerdict !== d.verdict ? (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400"
              title="The prospect's current verdict has since changed"
            >
              now {REPLY_VERDICT_LABEL[d.latestVerdict]}
            </Badge>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {formatDateTime(d.createdAt)}
          </span>
        </div>

        <div className="px-4 py-3">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {d.prospectEmail}
            {d.model ? <span className="ml-2">· {d.model}</span> : null}
          </p>
          <p className="whitespace-pre-wrap rounded-lg border bg-background/50 p-3 text-sm">
            {d.suggestedReply}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={copyDraft}>
              <Copy />
              Copy draft
            </Button>
            <Button size="sm" variant="outline" onClick={onOpenProspect}>
              <UserSearch />
              Open prospect
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowThread((s) => !s)}
              aria-expanded={showThread}
            >
              <MessageSquare />
              {showThread ? 'Hide' : 'Show'} conversation
              <ChevronDown
                className={cn(
                  'size-4 transition-transform',
                  showThread && 'rotate-180',
                )}
              />
            </Button>
          </div>

          {showThread ? (
            <div className="mt-3 border-t pt-3">
              <OutreachThread prospectId={d.prospectId} enabled={showThread} />
            </div>
          ) : null}
        </div>
      </Card>
    </li>
  );
}

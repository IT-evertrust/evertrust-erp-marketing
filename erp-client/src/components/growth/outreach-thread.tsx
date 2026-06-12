'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { OutreachMessageDto } from '@evertrust/shared';
import { useOutreachThread } from '@/hooks/use-outreach';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';

// Reusable conversation timeline for one prospect: INBOUND / OUTBOUND bubbles with
// subject, snippet and time. Used in the prospect drawer + the draft-review thread.
// `enabled` lets callers defer the fetch until the surface is visible.
export function OutreachThread({
  prospectId,
  enabled = true,
}: {
  prospectId: string;
  enabled?: boolean;
}) {
  const q = useOutreachThread(prospectId, enabled);

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-16 w-3/4 rounded-lg" />
        <Skeleton className="ml-auto h-16 w-3/4 rounded-lg" />
        <Skeleton className="h-16 w-3/4 rounded-lg" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not load the conversation: {q.error.message}
      </p>
    );
  }

  const messages = q.data ?? [];
  if (messages.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No messages yet — the outreach ledger is empty for this prospect.
      </p>
    );
  }

  // The API returns newest-first; render oldest→newest so the thread reads top-down.
  const ordered = [...messages].reverse();

  return (
    <ol className="flex flex-col gap-2.5">
      {ordered.map((m) => (
        <ThreadBubble key={m.id} message={m} />
      ))}
    </ol>
  );
}

function ThreadBubble({ message: m }: { message: OutreachMessageDto }) {
  const outbound = m.direction === 'OUTBOUND';
  return (
    <li
      className={cn(
        'max-w-[85%] rounded-xl border px-3 py-2',
        outbound
          ? 'ml-auto border-sky-500/30 bg-sky-500/10'
          : 'mr-auto border-border bg-card',
      )}
    >
      <div className="mb-0.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {outbound ? (
          <ArrowUpRight className="size-3.5 text-sky-400" />
        ) : (
          <ArrowDownLeft className="size-3.5 text-emerald-400" />
        )}
        <span>{outbound ? 'Sent' : 'Received'}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="lowercase">{m.status.toLowerCase()}</span>
        <span className="ml-auto tabular-nums normal-case tracking-normal">
          {formatDateTime(m.sentAt ?? m.createdAt)}
        </span>
      </div>
      {m.subject ? (
        <p className="text-sm font-medium">{m.subject}</p>
      ) : null}
      {m.bodySnippet ? (
        <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
          {m.bodySnippet}
        </p>
      ) : null}
      {m.error ? (
        <p className="mt-1 text-xs text-rose-400">{m.error}</p>
      ) : null}
    </li>
  );
}

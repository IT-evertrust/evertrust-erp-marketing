import { LiveDot } from '@/modules/(growth)/shared';

import type { AiAgentMode, CampaignReply } from '../types';
import { AiAgentBox } from './ai-agent-box';

type ReplyDetailProps = {
  reply?: CampaignReply;
  aiMode: AiAgentMode;
  onChangeAiMode: (mode: AiAgentMode) => void;
};

export function ReplyDetail({
  reply,
  aiMode,
  onChangeAiMode,
}: ReplyDetailProps) {
  if (!reply) {
    return (
      <section className="flex min-h-[560px] items-center justify-center p-6">
        <div className="rounded-lg border border-dashed border-border bg-muted px-6 py-8 text-center text-[12.5px] font-bold text-muted-foreground">
          Pick a campaign with replies to draft responses.
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[560px] flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-foreground">
            {reply.company}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {reply.contact}
          </div>
        </div>

        <span className="rounded-full border border-border px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {reply.category}
        </span>
      </div>

      <div className="max-h-[260px] overflow-auto rounded-[10px] border border-border p-3">
        <div className="flex flex-col gap-2.5">
          {reply.thread.map((message) => (
            <div
              key={message.id}
              className={[
                'max-w-[90%] rounded-[10px] border border-border bg-muted px-4 py-3',
                message.direction === 'outbound'
                  ? 'self-end'
                  : 'self-start bg-card',
              ].join(' ')}
            >
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                {message.header}
              </div>
              <div className="mb-2 text-[12.5px] font-bold text-foreground">
                {message.subject}
              </div>
              <div className="whitespace-pre-line text-[12.5px] leading-relaxed text-muted-foreground">
                {message.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-border bg-card">
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <LiveDot />
            Sorter: {reply.category} · AI Reply Draft
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            <input
              defaultValue={reply.draftSubject}
              className="w-full border-b border-border bg-transparent px-3 py-2.5 text-[12.5px] font-bold text-foreground outline-none focus:bg-card"
            />

            <textarea
              defaultValue={reply.draftBody}
              rows={7}
              className="w-full resize-none bg-transparent px-3 py-3 text-[12.5px] leading-relaxed text-foreground outline-none focus:bg-card"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background">
              Send
            </button>
            <button className="rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground">
              Save draft
            </button>
          </div>
        </div>

        <AiAgentBox mode={aiMode} onChangeMode={onChangeAiMode} />
      </div>
    </section>
  );
}
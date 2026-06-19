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
        <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
          Pick a campaign with replies to draft responses.
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[560px] flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-[#15171c]">
            {reply.company}
          </div>
          <div className="mt-1 text-[11px] text-[#959ca7]">
            {reply.contact}
          </div>
        </div>

        <span className="rounded-full border border-[#c2c7ce] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
          {reply.category}
        </span>
      </div>

      <div className="max-h-[260px] overflow-auto rounded-[10px] border border-[#c2c7ce] p-3">
        <div className="flex flex-col gap-2.5">
          {reply.thread.map((message) => (
            <div
              key={message.id}
              className={[
                'max-w-[90%] rounded-[10px] border border-[#d6dade] bg-[#f6f7f9] px-4 py-3',
                message.direction === 'outbound'
                  ? 'self-end'
                  : 'self-start bg-white',
              ].join(' ')}
            >
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
                {message.header}
              </div>
              <div className="mb-2 text-[12.5px] font-bold text-[#15171c]">
                {message.subject}
              </div>
              <div className="whitespace-pre-line text-[12.5px] leading-relaxed text-[#5b626d]">
                {message.body}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-[#c2c7ce] bg-white">
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
            <LiveDot />
            Sorter: {reply.category} · AI Reply Draft
          </div>

          <div className="overflow-hidden rounded-lg border border-[#e4e7eb] bg-[#f6f7f9]">
            <input
              defaultValue={reply.draftSubject}
              className="w-full border-b border-[#e4e7eb] bg-transparent px-3 py-2.5 text-[12.5px] font-bold text-[#15171c] outline-none focus:bg-white"
            />

            <textarea
              defaultValue={reply.draftBody}
              rows={7}
              className="w-full resize-none bg-transparent px-3 py-3 text-[12.5px] leading-relaxed text-[#15171c] outline-none focus:bg-white"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
              Send
            </button>
            <button className="rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c]">
              Save draft
            </button>
          </div>
        </div>

        <AiAgentBox mode={aiMode} onChangeMode={onChangeAiMode} />
      </div>
    </section>
  );
}
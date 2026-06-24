'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { LiveDot } from '@/modules/(growth)/shared';

import {
  addCampaignTraining,
  redraftReply,
  saveReplyDraft,
  sendReply,
} from '../services/engage.service';
import type { AiAgentMode, CampaignReply, ReplyThreadMessage } from '../types';
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
  // Draft is editable + controlled, so switching replies always shows the right text
  // and Send/Save read the latest edits.
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  // Messages sent this session, appended to the thread so the rep immediately SEES
  // their reply land in the conversation (the server has it; this avoids a slow refetch).
  const [sentMessages, setSentMessages] = useState<ReplyThreadMessage[]>([]);
  const [justSent, setJustSent] = useState(false);

  const replyId = reply?.id;
  useEffect(() => {
    setSubject(reply?.draftSubject ?? '');
    setBody(reply?.draftBody ?? '');
    setSentMessages([]);
    setJustSent(false);
  }, [replyId, reply?.draftSubject, reply?.draftBody]);

  if (!reply) {
    return (
      <section className="flex min-h-[560px] items-center justify-center p-6">
        <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
          Pick a campaign with replies to draft responses.
        </div>
      </section>
    );
  }

  async function handleSave() {
    if (!reply) return;
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    setSaving(true);
    try {
      await saveReplyDraft(reply.id, subject, body);
      toast.success('Draft saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save draft.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!reply) return;
    if (!subject.trim() || !body.trim()) {
      toast.error('Subject and body are required.');
      return;
    }
    setSending(true);
    try {
      await sendReply(reply.id, subject, body);
      // Show the just-sent reply in the thread immediately (it's now in Gmail too).
      setSentMessages((prev) => [
        ...prev,
        {
          id: `sent-${prev.length}`,
          direction: 'outbound',
          header: `EVERTRUST → ${reply.company.toUpperCase()} · just now`,
          subject: subject.trim().toLowerCase().startsWith('re:')
            ? subject
            : `Re: ${subject}`,
          body,
        },
      ]);
      setJustSent(true);
      toast.success(`Reply sent to ${reply.contact} from your campaign mailbox.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reply.');
    } finally {
      setSending(false);
    }
  }

  // Write & Fix: ask the agent to revise the current draft, then load the result
  // into the editor. Slow (LLM) — guard with `applying`.
  async function handleApply(instruction: string) {
    if (!reply) return;
    setApplying(true);
    try {
      const next = await redraftReply(reply.id, instruction);
      setSubject(next.draftSubject);
      setBody(next.draftBody);
      toast.success('Draft updated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revise the draft.');
    } finally {
      setApplying(false);
    }
  }

  // Train · Feedback: persist a note the drafter applies to all future drafts for
  // this campaign.
  async function handleSaveTraining(note: string) {
    if (!reply) return;
    try {
      await addCampaignTraining(reply.campaignId, note);
      toast.success('Got it — future drafts will apply this.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save feedback.');
    }
  }

  const threadMessages = [...(reply?.thread ?? []), ...sentMessages];

  return (
    <section className="flex min-h-[560px] flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-[#15171c]">
            {reply.company}
          </div>
          <div className="mt-1 text-[11px] text-[#959ca7]">{reply.contact}</div>
        </div>

        <span className="rounded-full border border-[#c2c7ce] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
          {reply.category}
        </span>
      </div>

      <div className="max-h-[300px] overflow-auto rounded-[10px] border border-[#c2c7ce] p-3">
        <div className="flex flex-col gap-2.5">
          {threadMessages.map((message) => (
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
              <div className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-[#5b626d]">
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
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              className="w-full border-b border-[#e4e7eb] bg-transparent px-3 py-2.5 text-[12.5px] font-bold text-[#15171c] outline-none focus:bg-white"
            />

            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={9}
              placeholder="Draft reply…"
              className="w-full resize-y bg-transparent px-3 py-3 text-[12.5px] leading-relaxed text-[#15171c] outline-none focus:bg-white"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || saving}
              className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-50"
            >
              {sending ? 'Sending…' : justSent ? 'Sent ✓' : 'Send'}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || sending}
              className="rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          </div>
        </div>

        <AiAgentBox
          mode={aiMode}
          onChangeMode={onChangeAiMode}
          onApply={handleApply}
          onSaveTraining={handleSaveTraining}
          applying={applying}
        />
      </div>
    </section>
  );
}

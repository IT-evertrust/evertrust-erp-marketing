'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CalendarCheck, CalendarPlus } from 'lucide-react';

import { LiveDot } from '@/modules/(growth)/shared';

import {
  addCampaignTraining,
  type CalendarSlot,
  getCampaignFreeSlots,
  markReplyBooked,
  redraftReply,
  saveReplyDraft,
  sendReply,
} from '../services/engage.service';
import type { AiAgentMode, CampaignReply, ReplyThreadMessage } from '../types';
import { AiAgentBox } from './ai-agent-box';
import { BookMeetingDialog } from './book-meeting-dialog';

// Compact slot label in the org's time zone with an offset label, e.g.
// "Tue 24 Jun · 15:00–15:30 (GMT+2) · 20:00–20:30 (GMT+7)". When `secondaryTimeZone` is
// set the org's cross-reference zone is appended (matching the email). `timeZone` is
// optional — without it we fall back to the viewer's local zone (no offset label).
function formatSlot(
  slot: CalendarSlot,
  timeZone?: string,
  secondaryTimeZone?: string | null,
): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const tz = timeZone || undefined;
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: tz,
  }).format(start);
  const time = (date: Date, zone?: string) =>
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: zone,
    }).format(date);
  const offset = (zone?: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZoneName: 'shortOffset', timeZone: zone })
      .formatToParts(start)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';
  const primary = `${day} · ${time(start, tz)}–${time(end, tz)}${tz ? ` (${offset(tz)})` : ''}`;
  if (!secondaryTimeZone) return primary;
  return `${primary} · ${time(start, secondaryTimeZone)}–${time(end, secondaryTimeZone)} (${offset(secondaryTimeZone)})`;
}

// The draft line the rep drops in when they hold a slot, e.g.
// "How about Tuesday 24 Jun at 15:00 (Europe/Berlin)? …".
function proposalLine(slot: CalendarSlot, timeZone: string): string {
  const start = new Date(slot.start);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    timeZone,
  }).format(start);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(start);
  return `How about ${day} at ${time} (${timeZone})? I've held the slot and sent a calendar invite.`;
}

type ReplyDetailProps = {
  reply?: CampaignReply;
  aiMode: AiAgentMode;
  onChangeAiMode: (mode: AiAgentMode) => void;
  // The campaign's mailbox google_accounts id — books meetings on that calendar.
  mailboxAccountId?: string | null;
};

export function ReplyDetail({
  reply,
  aiMode,
  onChangeAiMode,
  mailboxAccountId = null,
}: ReplyDetailProps) {
  // Draft is editable + controlled, so switching replies always shows the right text
  // and Send/Save read the latest edits.
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  // Messages sent this session, appended to the thread so the rep immediately SEES
  // their reply land in the conversation (the server has it; this avoids a slow refetch).
  const [sentMessages, setSentMessages] = useState<ReplyThreadMessage[]>([]);
  const [justSent, setJustSent] = useState(false);
  // "Propose times": the fetched bookable windows + the rep's chosen one (passed to Send).
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [slotsTimeZone, setSlotsTimeZone] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<CalendarSlot | null>(null);
  // The full set of windows the rep has offered this round — passed to Send so the
  // backend persists exactly what was put on the table (for later accept/counter match).
  const [proposedSlots, setProposedSlots] = useState<CalendarSlot[]>([]);
  // When set, BookMeetingDialog opens pre-filled with this exact accepted window.
  const [bookPreset, setBookPreset] = useState<CalendarSlot | null>(null);
  // Optimistic BOOKED state after a one-click book, so the chip flips without a refetch.
  const [bookedLocally, setBookedLocally] = useState(false);

  const replyId = reply?.id;
  useEffect(() => {
    setSubject(reply?.draftSubject ?? '');
    // Strip the internal meeting-time markers from the editor view (the backend strips
    // them from the outgoing email too) — the operator sees only the natural prose.
    setBody((reply?.draftBody ?? '').replace(/<!--\/?meeting-time-->/g, ''));
    setSentMessages([]);
    setJustSent(false);
    setLoadingSlots(false);
    setSlots([]);
    setSlotsTimeZone('');
    setSelectedSlot(null);
    setProposedSlots([]);
    setBookPreset(null);
    setBookedLocally(false);
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
      const offered = proposedSlots.length > 0 ? proposedSlots : undefined;
      const result = await sendReply(
        reply.id,
        subject,
        body,
        selectedSlot ?? undefined,
        offered,
      );
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
      setSelectedSlot(null);
      setProposedSlots([]);
      if (result.meeting?.ok) {
        toast.success('Reply sent + calendar invite created.');
      } else {
        toast.success(`Reply sent to ${reply.contact} from your campaign mailbox.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reply.');
    } finally {
      setSending(false);
    }
  }

  // "Propose times": read the campaign calendar's bookable windows. If the calendar
  // isn't readable (configured:false) surface the reason and offer nothing.
  async function handleProposeTimes() {
    if (!reply || loadingSlots) return;
    setLoadingSlots(true);
    try {
      const data = await getCampaignFreeSlots(reply.campaignId);
      if (!data.configured) {
        setSlots([]);
        setSlotsTimeZone('');
        toast.error(data.reason ?? 'Calendar is not available for this campaign.');
        return;
      }
      setSlotsTimeZone(data.timeZone);
      setSlots(data.slots);
      if (data.slots.length === 0) {
        toast.message('No open slots in the calendar right now.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load free slots.');
    } finally {
      setLoadingSlots(false);
    }
  }

  // Pick a slot: hold it for Send, add it to the offered set (deduped), and append a
  // human-readable line to the editable draft.
  function handleSelectSlot(slot: CalendarSlot) {
    setSelectedSlot(slot);
    setProposedSlots((prev) =>
      prev.some((s) => s.start === slot.start && s.end === slot.end)
        ? prev
        : [...prev, slot],
    );
    const line = proposalLine(slot, slotsTimeZone);
    setBody((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${line}` : line));
  }

  // One-click "Book it" from the accepted-slot banner: open the dialog pre-filled with
  // the exact agreed window.
  function handleBookAccepted(slot: CalendarSlot) {
    setBookPreset(slot);
    setBookOpen(true);
  }

  // Close the meeting loop after a successful book: link the Activate meeting to the
  // reply and flip the local BOOKED chip.
  async function handleBooked(meetingId: string) {
    if (!reply) return;
    try {
      await markReplyBooked(reply.id, meetingId);
      setBookedLocally(true);
      toast.success('Meeting booked.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not link the meeting.');
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
      setBody(next.draftBody.replace(/<!--\/?meeting-time-->/g, ''));
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

  // Meeting-loop state (server value, or optimistic after a one-click book).
  const isBooked = bookedLocally || reply.meetingStatus === 'BOOKED';
  const showAcceptedBanner =
    !isBooked &&
    reply.meetingStatus === 'ACCEPTED' &&
    Boolean(reply.acceptedSlot);
  const showCounterBanner = !isBooked && reply.meetingStatus === 'COUNTER';

  // The client's words to scan for a proposed meeting time — the latest inbound thread
  // message, falling back to the classified reply's inbound body.
  function bookingHintText(r: CampaignReply): string {
    const lastInbound = [...(r.thread ?? [])]
      .reverse()
      .find((mssg) => mssg.direction === 'inbound');
    return lastInbound?.body || r.inboundBody || '';
  }

  return (
    <section className="flex min-h-[560px] flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-[#15171c]">
            {reply.company}
          </div>
          <div className="mt-1 text-[11px] text-[#959ca7]">{reply.contact}</div>
        </div>

        <div className="flex items-center gap-2">
          {isBooked ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#9bd3b0] bg-[#eaf7ef] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#1f7a45]">
              <CalendarCheck className="size-3.5" />
              Meeting booked
            </span>
          ) : (
            /* Engage→Activate: book a meeting straight from an interested reply. */
            reply.category === 'INTERESTED' && (
              <button
                type="button"
                onClick={() => {
                  setBookPreset(null);
                  setBookOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#15171c] bg-[#15171c] px-[10px] py-[6px] text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#2a2d33]"
                title="Create a calendar invite + Meet link, added to Activate"
              >
                <CalendarPlus className="size-3.5" />
                Book meeting
              </button>
            )
          )}
          <span className="rounded-full border border-[#c2c7ce] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#5b626d]">
            {reply.category}
          </span>
        </div>
      </div>

      {/* Meeting-loop banner: the client agreed to a time — book it in one click. */}
      {showAcceptedBanner && reply.acceptedSlot && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#9bd3b0] bg-[#eaf7ef] px-4 py-3">
          <div className="text-[12.5px] font-bold text-[#15171c]">
            Client accepted {formatSlot(reply.acceptedSlot, reply.timeZone, reply.secondaryTimeZone)} — Book it?
          </div>
          <button
            type="button"
            onClick={() => handleBookAccepted(reply.acceptedSlot!)}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#1f7a45] bg-[#1f7a45] px-[12px] py-[7px] text-[10px] font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-[#196138]"
          >
            <CalendarCheck className="size-3.5" />
            Book meeting
          </button>
        </div>
      )}

      {/* Meeting-loop banner: the client's time conflicts — alternatives are drafted below. */}
      {showCounterBanner && (
        <div className="rounded-[10px] border border-[#e6cf8b] bg-[#fbf4dd] px-4 py-3 text-[12.5px] font-bold text-[#7a5b15]">
          Client&rsquo;s time conflicts — alternatives drafted below; review &amp; send.
        </div>
      )}

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
            <button
              type="button"
              onClick={handleProposeTimes}
              disabled={loadingSlots || sending}
              className="rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c] disabled:opacity-50"
            >
              {loadingSlots ? 'Loading…' : 'Propose times'}
            </button>
          </div>

          {slots.length > 0 && (
            <div className="mt-3 rounded-lg border border-[#e4e7eb] bg-[#f6f7f9] p-3">
              <div className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
                Pick a slot to propose
                {slotsTimeZone ? ` · ${slotsTimeZone}` : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                {slots.slice(0, 6).map((slot) => {
                  const active =
                    selectedSlot?.start === slot.start &&
                    selectedSlot?.end === slot.end;
                  return (
                    <button
                      key={`${slot.start}-${slot.end}`}
                      type="button"
                      onClick={() => handleSelectSlot(slot)}
                      className={[
                        'rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-[0.02em]',
                        active
                          ? 'border-[#15171c] bg-[#15171c] text-white'
                          : 'border-[#c2c7ce] bg-white text-[#15171c] hover:border-[#15171c]',
                      ].join(' ')}
                    >
                      {formatSlot(slot, slotsTimeZone)}
                    </button>
                  );
                })}
              </div>
              {selectedSlot && (
                <div className="mt-2 text-[10px] leading-relaxed text-[#959ca7]">
                  Slot added to the draft — Send will hold it and invite{' '}
                  {reply.contact}.
                </div>
              )}
            </div>
          )}
        </div>

        <AiAgentBox
          mode={aiMode}
          onChangeMode={onChangeAiMode}
          onApply={handleApply}
          onSaveTraining={handleSaveTraining}
          applying={applying}
        />
      </div>

      <BookMeetingDialog
        open={bookOpen}
        onClose={() => {
          setBookOpen(false);
          setBookPreset(null);
        }}
        company={reply.company}
        clientEmail={reply.contact}
        suggestedText={bookingHintText(reply)}
        mailboxAccountId={mailboxAccountId}
        presetSlot={bookPreset ?? undefined}
        onBooked={handleBooked}
      />
    </section>
  );
}

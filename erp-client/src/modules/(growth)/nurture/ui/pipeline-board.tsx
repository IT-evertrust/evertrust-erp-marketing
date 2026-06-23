'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ProspectDto, ProspectStatus } from '@evertrust/shared';
import { useProspectsBoard } from '@/hooks/use-prospects';
import { ProspectDetailDrawer } from '@/components/growth/prospect-detail-drawer';

// Big page so the kanban shows a meaningful slice of the pipeline at once.
const PAGE_SIZE = 200;

// The marketing department's pipeline (attached design) is a six-stage SALES funnel:
// INTEREST → INTENT → CONSIDERATION → DECISION → WON / LOST. Our live data is the
// prospect_status funnel, so we map each stage onto the real statuses that belong to
// it. NEW / EMAILED are pre-engagement (they live in Reach, not Nurture) and are
// intentionally excluded. DECISION / WON have no status to back them yet — they're
// reserved columns until a deal-close concept exists, and render empty by design.
type StageKey =
  | 'INTEREST'
  | 'INTENT'
  | 'CONSIDERATION'
  | 'DECISION'
  | 'WON'
  | 'LOST';

const STAGES: Array<{
  key: StageKey;
  label: string;
  statuses: ProspectStatus[];
  tone?: 'won' | 'lost';
}> = [
  { key: 'INTEREST', label: 'INTEREST', statuses: ['REPLIED', 'RE_ENGAGED'] },
  { key: 'INTENT', label: 'INTENT', statuses: ['INTERESTED'] },
  {
    key: 'CONSIDERATION',
    label: 'CONSIDERATION',
    statuses: ['MEETING_SCHEDULED'],
  },
  { key: 'DECISION', label: 'DECISION', statuses: [] },
  { key: 'WON', label: 'WON', statuses: [], tone: 'won' },
  {
    key: 'LOST',
    label: 'LOST',
    statuses: ['NOT_INTERESTED', 'DO_NOT_CONTACT'],
    tone: 'lost',
  },
];

// Faithful re-creation of the attached design's `.kanban.six`, white-themed with the
// app's light tokens. Six columns, each a stack of `.lead` cards (company, contact,
// sector tag, signal) with a per-column footer total. Data is REAL prospects
// (GET /prospects/board) mapped into the six stages; a card click opens the live
// prospect detail drawer.
export function PipelineBoard({ campaignId }: { campaignId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const q = useProspectsBoard({ campaignId, limit: PAGE_SIZE, offset: 0 });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const statusCounts = q.data?.statusCounts ?? {};

  // Group the page's prospects into the six design stages.
  const byStage = useMemo(() => {
    const map = {} as Record<StageKey, ProspectDto[]>;
    for (const s of STAGES) map[s.key] = [];
    const stageOf = new Map<ProspectStatus, StageKey>();
    for (const s of STAGES) for (const st of s.statuses) stageOf.set(st, s.key);
    for (const p of items) {
      const stage = stageOf.get(p.status);
      if (stage) map[stage].push(p);
    }
    return map;
  }, [items]);

  // Header count = full per-stage tally (unaffected by the page window).
  function stageCount(stage: (typeof STAGES)[number]): number {
    return stage.statuses.reduce(
      (sum, st) => sum + (statusCounts[st] ?? 0),
      0,
    );
  }

  if (q.isLoading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-white text-[12.5px] font-bold text-[#959ca7]">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading pipeline…
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-[10px] border border-[#e4e7eb] bg-white px-6 py-10 text-center text-[12.5px] font-bold text-[#b91c1c]">
        Couldn’t load the pipeline. {q.error.message}
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-[#e4e7eb] bg-white">
      <div className="p-4">
        <div className="grid auto-rows-fr grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const cards = byStage[stage.key];
            const count = stageCount(stage);
            return (
              <div
                key={stage.key}
                className="flex min-h-[440px] flex-col rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9] p-2.5"
              >
                <div className="mb-[9px] flex items-center justify-between border-b border-[#e4e7eb] px-0.5 pb-[9px] text-[9.5px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
                  <b className="text-[#15171c]">{stage.label}</b>
                  <span className="rounded-full border border-[#d6dade] bg-[#eceef1] px-1.5 text-[#5b626d]">
                    {count}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-[3px]">
                  {cards.length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-[#d6dade] px-3 py-5 text-center text-[10.5px] font-bold text-[#bcc2cb]">
                      {stage.tone === 'won'
                        ? 'No closed-won deals yet'
                        : stage.key === 'DECISION'
                          ? 'Nothing in decision'
                          : 'Empty'}
                    </div>
                  ) : (
                    cards.map((p) => (
                      <LeadCard
                        key={p.id}
                        prospect={p}
                        tone={stage.tone}
                        onOpen={() => setOpenId(p.id)}
                      />
                    ))
                  )}
                </div>

                <div className="mt-[9px] border-t border-[#e4e7eb] pt-[9px] text-center">
                  <div className="text-[11.5px] font-bold text-[#15171c]">
                    Total: {count} {count === 1 ? 'lead' : 'leads'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ProspectDetailDrawer
        prospectId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

// One `.lead` card. Company on top, contact/location underneath, and a footer with a
// sector tag (left) + a real signal (right: verified state or follow-up count). WON
// cards get a ✓ after the company; LOST cards are dimmed — both per the design.
function LeadCard({
  prospect: p,
  tone,
  onOpen,
}: {
  prospect: ProspectDto;
  tone?: 'won' | 'lost';
  onOpen: () => void;
}) {
  const company = p.companyName || p.email;
  const location = [p.city, p.country].filter(Boolean).join(', ');
  const tag = (p.country || 'LEAD').toUpperCase();
  const signal = p.emailVerified
    ? '✓ Verified'
    : p.followupCount > 0
      ? `${p.followupCount}× sent`
      : '—';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={[
        'relative w-full rounded-[8px] border border-[#d6dade] bg-white p-2.5 text-left transition-colors hover:border-[#c2c7ce] hover:bg-[#fbfbfc]',
        tone === 'lost' ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="truncate text-[12px] font-bold text-[#15171c]">
        {company}
        {tone === 'won' ? <span className="text-[#15171c]"> ✓</span> : null}
      </div>
      <div className="mt-px truncate text-[10.5px] text-[#959ca7]">
        {location || p.email}
      </div>
      <div className="mt-[9px] flex items-center justify-between">
        <span className="rounded-[5px] border border-[#c2c7ce] px-[5px] py-px text-[9px] font-bold tracking-[0.05em] text-[#5b626d]">
          {tag}
        </span>
        <span className="text-[10.5px] font-bold text-[#15171c]">{signal}</span>
      </div>
    </button>
  );
}

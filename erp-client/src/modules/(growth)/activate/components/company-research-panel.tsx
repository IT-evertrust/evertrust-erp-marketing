import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { ResearchDossier } from '../types';

type CompanyResearchPanelProps = {
  dossiers: ResearchDossier[];
  selectedDossierId: string;
  onSelectDossier: (dossierId: string) => void;
  selectedDossier?: ResearchDossier;
  loading?: boolean;
  generating?: boolean;
};

export function CompanyResearchPanel({
  dossiers,
  selectedDossierId,
  onSelectDossier,
  selectedDossier,
  loading = false,
  generating = false,
}: CompanyResearchPanelProps) {
  return (
    <GrowthCard title="Company Research">
      <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-[#e4e7eb]">
        <aside className="border-r border-[#e4e7eb]">
          <div className="border-b border-[#e4e7eb] p-3.5">
            <span className="rounded-full border border-[#15171c] bg-[#15171c] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-white">
              Upcoming meetings · {dossiers.length}
            </span>
          </div>

          {loading && dossiers.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
              Loading meetings…
            </div>
          ) : dossiers.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
              No upcoming meetings on this calendar.
            </div>
          ) : (
            dossiers.map((dossier) => {
              const selected = selectedDossierId === dossier.id;

              return (
                <button
                  key={dossier.id}
                  type="button"
                  onClick={() => onSelectDossier(dossier.id)}
                  className={[
                    'block w-full border-b border-[#e4e7eb] px-4 py-3 text-left hover:bg-[#f6f7f9]',
                    selected
                      ? 'bg-[#f6f7f9] shadow-[inset_2px_0_0_#15171c]'
                      : 'bg-white',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-bold text-[#15171c]">
                      {dossier.company}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#959ca7]">
                      {dossier.meetingTime}
                    </span>
                  </div>

                  <div className="mt-1 text-[11px] text-[#959ca7]">
                    {dossier.status} · {dossier.contact.split(' · ')[0]}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="p-5">
          {!selectedDossier ? (
            <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
              Select a meeting to view the dossier.
            </div>
          ) : selectedDossier.status === 'Being generated' ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
              {generating
                ? 'Researching the company — building the dossier…'
                : 'Dossier will be generated when you open this meeting.'}
            </div>
          ) : (
            <DossierDetail dossier={selectedDossier} />
          )}
        </section>
      </div>
    </GrowthCard>
  );
}

function DossierDetail({ dossier }: { dossier: ResearchDossier }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-[#15171c]">
            {dossier.company} · Pre-Meeting Dossier
          </div>
          <div className="mt-1 text-[11px] text-[#959ca7]">
            Meeting: {dossier.meetingTime} · {dossier.contact}
          </div>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-[#d6dade] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d]">
          <LiveDot />
          Auto-generated
        </span>
      </div>

      {dossier.mbti || dossier.personality || dossier.mbtiReasoning ? (
        <section className="rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9] p-4">
          <SectionTitle>Client Read · Personality</SectionTitle>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {dossier.mbti ? (
              <span className="rounded-md bg-[#15171c] px-2.5 py-1 text-[12px] font-bold tracking-[0.12em] text-white">
                {dossier.mbti}
              </span>
            ) : null}
            {typeof dossier.mbtiConfidence === 'number' ? (
              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
                {Math.round((dossier.mbtiConfidence ?? 0) * 100)}% confidence
              </span>
            ) : null}
            {dossier.personality ? (
              <span className="text-[11.5px] text-[#5b626d]">
                {[
                  dossier.personality.tone,
                  dossier.personality.decisiveness,
                  dossier.personality.formality,
                  dossier.personality.detail,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : null}
          </div>
          {dossier.mbtiReasoning ? (
            <p className="text-[11.5px] leading-relaxed text-[#5b626d]">
              {dossier.mbtiReasoning}
            </p>
          ) : null}
        </section>
      ) : null}

      {dossier.interactionContext ? (
        <section>
          <SectionTitle>Where it stands</SectionTitle>
          <p className="text-[12.5px] leading-relaxed text-[#5b626d]">
            {dossier.interactionContext}
          </p>
        </section>
      ) : null}

      {dossier.profile.length > 0 ? (
        <section>
          <SectionTitle>Company Profile</SectionTitle>
          {dossier.profile.map((item) => (
            <div
              key={item.label}
              className="flex justify-between border-b border-dashed border-[#d6dade] py-2 text-[12.5px]"
            >
              <span className="text-[#959ca7]">{item.label}</span>
              <b className="text-[#15171c]">{item.value}</b>
            </div>
          ))}
        </section>
      ) : null}

      {dossier.signals.length > 0 ? (
        <section>
          <SectionTitle>Signals</SectionTitle>
          {dossier.signals.map((signal) => (
            <Bullet key={signal}>{signal}</Bullet>
          ))}
        </section>
      ) : null}

      {dossier.talkingPoints.length > 0 ? (
        <section>
          <SectionTitle>Talking Points</SectionTitle>
          {dossier.talkingPoints.map((point) => (
            <Bullet key={point}>{point}</Bullet>
          ))}
        </section>
      ) : null}

      {dossier.history && dossier.history.length > 0 ? (
        <section>
          <SectionTitle>Interaction History</SectionTitle>
          {dossier.history.map((h, i) => (
            <div
              key={`${h.date ?? ''}-${i}`}
              className="flex gap-2 border-b border-dashed border-[#d6dade] py-2 text-[12.5px] text-[#5b626d]"
            >
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-[#959ca7]">
                {h.date || h.kind}
              </span>
              <span>{h.summary}</span>
            </div>
          ))}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-[#c2c7ce] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#15171c]">
          As PDF
        </button>
        <button className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
          Attach to calendar event
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#959ca7]">
      {children}
    </h3>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 text-[12.5px] text-[#5b626d]">
      <span className="font-bold text-[#15171c]">›</span>
      <span>{children}</span>
    </div>
  );
}

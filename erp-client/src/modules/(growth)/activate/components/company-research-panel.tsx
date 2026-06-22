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
      <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-border">
        <aside className="border-r border-border">
          <div className="border-b border-border p-3.5">
            <span className="rounded-full border border-foreground bg-foreground px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-background">
              Upcoming meetings · {dossiers.length}
            </span>
          </div>

          {loading && dossiers.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-muted-foreground">
              Loading meetings…
            </div>
          ) : dossiers.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-muted-foreground">
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
                    'block w-full border-b border-border px-4 py-3 text-left hover:bg-muted',
                    selected
                      ? 'bg-sidebar-accent shadow-[inset_2px_0_0_var(--foreground)]'
                      : 'bg-card',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-bold text-foreground">
                      {dossier.company}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {dossier.meetingTime}
                    </span>
                  </div>

                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {dossier.status} · {dossier.contact.split(' · ')[0]}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="p-5">
          {!selectedDossier ? (
            <div className="rounded-lg border border-dashed border-border bg-muted px-6 py-8 text-center text-[12.5px] font-bold text-muted-foreground">
              Select a meeting to view the dossier.
            </div>
          ) : selectedDossier.status === 'Being generated' ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-lg border border-dashed border-border bg-muted px-6 py-8 text-center text-[12.5px] font-bold text-muted-foreground">
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
          <div className="text-[15px] font-bold text-foreground">
            {dossier.company} · Pre-Meeting Dossier
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Meeting: {dossier.meetingTime} · {dossier.contact}
          </div>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          <LiveDot />
          Auto-generated
        </span>
      </div>

      {dossier.profile.length > 0 ? (
        <section>
          <SectionTitle>Company Profile</SectionTitle>
          {dossier.profile.map((item) => (
            <div
              key={item.label}
              className="flex justify-between border-b border-dashed border-border py-2 text-[12.5px]"
            >
              <span className="text-muted-foreground">{item.label}</span>
              <b className="text-foreground">{item.value}</b>
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

      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-foreground">
          As PDF
        </button>
        <button className="rounded-md border border-foreground bg-foreground px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-background">
          Attach to calendar event
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
      {children}
    </h3>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 py-1.5 text-[12.5px] text-muted-foreground">
      <span className="font-bold text-foreground">›</span>
      <span>{children}</span>
    </div>
  );
}

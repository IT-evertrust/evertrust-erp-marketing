import { GrowthCard, LiveDot, Spinner } from '@/modules/(growth)/shared';

import type { ClientResearch, ResearchDossier } from '../types';

type CompanyResearchPanelProps = {
  dossiers: ResearchDossier[];
  selectedDossierId: string;
  onSelectDossier: (dossierId: string) => void;
  selectedDossier?: ResearchDossier;
  loading?: boolean;
  generating?: boolean;
  // ---- Client Research (additive: persisted deep dossier for the company) ----
  clientResearch?: ClientResearch | null;
  loadingClientResearch?: boolean;
  generatingClientResearch?: boolean;
  onGenerateClientResearch?: () => void;
};

export function CompanyResearchPanel({
  dossiers,
  selectedDossierId,
  onSelectDossier,
  selectedDossier,
  loading = false,
  generating = false,
  clientResearch = null,
  loadingClientResearch = false,
  generatingClientResearch = false,
  onGenerateClientResearch,
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
            <DossierDetail
              dossier={selectedDossier}
              clientResearch={clientResearch}
              loadingClientResearch={loadingClientResearch}
              generatingClientResearch={generatingClientResearch}
              onGenerateClientResearch={onGenerateClientResearch}
            />
          )}
        </section>
      </div>
    </GrowthCard>
  );
}

function DossierDetail({
  dossier,
  clientResearch,
  loadingClientResearch,
  generatingClientResearch,
  onGenerateClientResearch,
}: {
  dossier: ResearchDossier;
  clientResearch?: ClientResearch | null;
  loadingClientResearch?: boolean;
  generatingClientResearch?: boolean;
  onGenerateClientResearch?: () => void;
}) {
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

      <ClientResearchSection
        research={clientResearch}
        loading={loadingClientResearch}
        generating={generatingClientResearch}
        onGenerate={onGenerateClientResearch}
      />

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

// ---- Client Research (additive section: MBTI + personality + deal economics) ----
function ClientResearchSection({
  research,
  loading = false,
  generating = false,
  onGenerate,
}: {
  research?: ClientResearch | null;
  loading?: boolean;
  generating?: boolean;
  onGenerate?: () => void;
}) {
  const hasResearch = Boolean(research);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Client Research
        </h3>

        <div className="flex items-center gap-2">
          {hasResearch && research ? <StageBadge stage={research.stage} /> : null}
          {onGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-background disabled:opacity-60"
            >
              {generating ? (
                <Spinner inline size={12} />
              ) : null}
              {generating
                ? 'Generating…'
                : hasResearch
                  ? 'Refresh'
                  : 'Generate research'}
            </button>
          ) : null}
        </div>
      </div>

      {generating ? (
        <Spinner label="Researching the client — building the profile…" />
      ) : loading ? (
        <Spinner label="Loading client research…" />
      ) : !research ? (
        <div className="rounded-lg border border-dashed border-border bg-muted px-5 py-6 text-center text-[12px] font-bold text-muted-foreground">
          No client research yet. Generate it to surface MBTI, personality, and deal economics.
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {research.mbti ? (
            <div>
              <SectionTitle>Personality Type (MBTI)</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-foreground bg-foreground px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-background">
                  {research.mbti}
                </span>
                {research.mbtiConfidence != null ? (
                  <span className="text-[11px] text-muted-foreground">
                    {Math.round(research.mbtiConfidence * 100)}% confidence
                  </span>
                ) : null}
              </div>
              {research.mbtiReasoning ? (
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  {research.mbtiReasoning}
                </p>
              ) : null}
            </div>
          ) : null}

          {research.personality ? (
            <div>
              <SectionTitle>Personality</SectionTitle>
              <div className="grid grid-cols-2 gap-x-4">
                <TraitRow label="Tone" value={research.personality.tone} />
                <TraitRow label="Decisiveness" value={research.personality.decisiveness} />
                <TraitRow label="Formality" value={research.personality.formality} />
                <TraitRow label="Detail" value={research.personality.detail} />
              </div>
            </div>
          ) : null}

          {research.interactionContext ? (
            <div>
              <SectionTitle>Interaction Context</SectionTitle>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                {research.interactionContext}
              </p>
            </div>
          ) : null}

          {research.history && research.history.length > 0 ? (
            <div>
              <SectionTitle>Interaction History</SectionTitle>
              <div className="flex flex-col gap-2.5 border-l border-border pl-4">
                {research.history.map((entry, index) => (
                  <div key={index} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-border bg-foreground" />
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.date ? (
                        <span className="text-[11px] font-bold text-foreground">
                          {entry.date}
                        </span>
                      ) : null}
                      {entry.kind ? (
                        <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          {entry.kind}
                        </span>
                      ) : null}
                    </div>
                    {entry.summary ? (
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        {entry.summary}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {research.talkingPoints && research.talkingPoints.length > 0 ? (
            <div>
              <SectionTitle>Talking Points</SectionTitle>
              {research.talkingPoints.map((point) => (
                <Bullet key={point}>{point}</Bullet>
              ))}
            </div>
          ) : null}

          {research.signals && research.signals.length > 0 ? (
            <div>
              <SectionTitle>Signals</SectionTitle>
              {research.signals.map((signal) => (
                <Bullet key={signal}>{signal}</Bullet>
              ))}
            </div>
          ) : null}

          {research.dealValue != null ? (
            <div>
              <SectionTitle>Deal Economics</SectionTitle>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[18px] font-bold text-foreground">
                  {formatDealValue(research.dealValue, research.dealCurrency)}
                </span>
                {research.dealBasis ? (
                  <span className="text-[11px] text-muted-foreground">
                    {research.dealBasis}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function StageBadge({ stage }: { stage: ClientResearch['stage'] }) {
  const label = stage === 'POST_MEETING' ? 'Post-meeting' : 'Pre-meeting';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
      <LiveDot />
      {label}
    </span>
  );
}

function TraitRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between border-b border-dashed border-border py-2 text-[12.5px]">
      <span className="text-muted-foreground">{label}</span>
      <b className="text-foreground">{value}</b>
    </div>
  );
}

function formatDealValue(value: number, currency?: string | null): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(value);
    } catch {
      // Unknown currency code — fall through to plain formatting.
    }
  }
  return `${new Intl.NumberFormat().format(value)}${currency ? ` ${currency}` : ''}`;
}

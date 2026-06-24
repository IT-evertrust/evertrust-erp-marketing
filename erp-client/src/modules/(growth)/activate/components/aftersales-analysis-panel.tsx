'use client';

import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { CallAnalysis, Persona } from '../types';

type AfterSalesAnalysisPanelProps = {
  analyses: CallAnalysis[];
  selectedAnalysisId: string;
  onSelectAnalysis: (analysisId: string) => void;
  selectedAnalysis?: CallAnalysis;
  loading?: boolean;
  personas: Persona[];
  selectedPersona: string;
  onSelectPersona: (persona: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;
  query: string;
  onQuery: (value: string) => void;
  date: string;
  onDate: (value: string) => void;
  onSyncReadAi: () => void;
  syncingReadAi: boolean;
};

export function AfterSalesAnalysisPanel({
  analyses,
  selectedAnalysisId,
  onSelectAnalysis,
  selectedAnalysis,
  loading = false,
  personas,
  selectedPersona,
  onSelectPersona,
  analyzing,
  onAnalyze,
  query,
  onQuery,
  date,
  onDate,
  onSyncReadAi,
  syncingReadAi,
}: AfterSalesAnalysisPanelProps) {
  return (
    <GrowthCard title="After-Sales Analysis">
      <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-[#e4e7eb]">
        <aside className="border-r border-[#e4e7eb]">
          <div className="border-b border-[#e4e7eb] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-[#15171c] bg-[#15171c] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-white">
                Recent calls · {analyses.length}
              </span>
              <button
                type="button"
                onClick={onSyncReadAi}
                disabled={syncingReadAi}
                title="Pull the meeting list + summaries from Read AI's report emails"
                className="rounded-md border border-[#15171c] bg-white px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-[#15171c] hover:bg-[#f6f7f9] disabled:opacity-50"
              >
                {syncingReadAi ? 'Syncing…' : 'Sync Read AI'}
              </button>
            </div>

            {/* Search by name + calendar day (server-side). */}
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={query}
                onChange={(event) => onQuery(event.target.value)}
                placeholder="Search by company or contact…"
                className="w-full rounded-[8px] border border-[#e4e7eb] bg-[#f6f7f9] px-2.5 py-1.5 text-[12px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
              />
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={date}
                  onChange={(event) => onDate(event.target.value)}
                  className="flex-1 rounded-[8px] border border-[#e4e7eb] bg-[#f6f7f9] px-2.5 py-1.5 text-[12px] text-[#15171c] outline-none focus:border-[#15171c] focus:bg-white"
                />
                {query || date ? (
                  <button
                    type="button"
                    onClick={() => {
                      onQuery('');
                      onDate('');
                    }}
                    className="rounded-[8px] border border-[#e4e7eb] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#5b626d] hover:bg-[#f6f7f9]"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {loading && analyses.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
              Loading calls…
            </div>
          ) : analyses.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] font-bold text-[#959ca7]">
              No analyzable calls yet.
            </div>
          ) : (
            analyses.map((analysis) => {
              const selected = selectedAnalysisId === analysis.id;

              return (
                <button
                  key={analysis.id}
                  type="button"
                  onClick={() => onSelectAnalysis(analysis.id)}
                  className={[
                    'block w-full border-b border-[#e4e7eb] px-4 py-3 text-left hover:bg-[#f6f7f9]',
                    selected
                      ? 'bg-[#f6f7f9] shadow-[inset_2px_0_0_#15171c]'
                      : 'bg-white',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-bold text-[#15171c]">
                      {analysis.company}
                    </span>
                    <span className="shrink-0 text-[10px] text-[#959ca7]">
                      {analysis.date}
                    </span>
                  </div>

                  <div className="mt-1 text-[11px] text-[#959ca7]">
                    {analysis.analyzed
                      ? `${analysis.duration} · ${analysis.sentiment} sentiment`
                      : 'Not analyzed yet'}
                  </div>
                </button>
              );
            })
          )}
        </aside>

        <section className="p-5">
          {selectedAnalysis ? (
            <AnalysisDetail
              analysis={selectedAnalysis}
              personas={personas}
              selectedPersona={selectedPersona}
              onSelectPersona={onSelectPersona}
              analyzing={analyzing}
              onAnalyze={onAnalyze}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
              Select a call to view analysis.
            </div>
          )}
        </section>
      </div>
    </GrowthCard>
  );
}

function AnalysisDetail({
  analysis,
  personas,
  selectedPersona,
  onSelectPersona,
  analyzing,
  onAnalyze,
}: {
  analysis: CallAnalysis;
  personas: Persona[];
  selectedPersona: string;
  onSelectPersona: (persona: string) => void;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold text-[#15171c]">
            {analysis.company} · Call Analysis
          </div>
          <div className="mt-1 text-[11px] text-[#959ca7]">
            {analysis.duration} · {analysis.contact} · {analysis.date}
          </div>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full border border-[#d6dade] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5b626d]">
          <LiveDot />
          Read AI
        </span>
      </div>

      {/* Sales-coach persona selector + run */}
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9] p-3">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-[#959ca7]">
          Sales Coach
        </span>
        <select
          value={selectedPersona}
          onChange={(event) => onSelectPersona(event.target.value)}
          className="rounded-[8px] border border-[#e4e7eb] bg-white px-3 py-1.5 text-[12.5px] text-[#15171c]"
        >
          {personas.map((persona) => (
            <option key={persona.id} value={persona.name}>
              {persona.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !analysis.hasTranscript}
          className="rounded-md border border-[#15171c] bg-[#15171c] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white disabled:opacity-50"
        >
          {analyzing ? 'Analyzing…' : analysis.analyzed ? 'Re-analyze' : 'Analyze'}
        </button>
        {analysis.persona ? (
          <span className="text-[11px] text-[#959ca7]">
            Lens: <b className="text-[#5b626d]">{analysis.persona}</b>
          </span>
        ) : null}
      </div>

      {!analysis.analyzed ? (
        <div className="rounded-lg border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-8 text-center text-[12.5px] font-bold text-[#959ca7]">
          {analysis.hasTranscript
            ? `Run the ${selectedPersona || 'sales coach'} analysis to score this call.`
            : 'No transcript stored for this call.'}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <MetricCard
              label="Talk Ratio (Client / AE)"
              value={analysis.talkRatio}
              percent={ratioPercent(analysis.talkRatio)}
            />
            <MetricCard
              label="Sentiment"
              value={analysis.sentiment}
              percent={sentimentPercent(analysis.sentiment)}
            />
            <MetricCard
              label="Close Probability"
              value={analysis.closeProbability}
              percent={bandPercent(analysis.closeProbability)}
            />
          </div>

          <section>
            <SectionTitle>Summary</SectionTitle>
            <p className="text-[13px] leading-relaxed text-[#5b626d]">{analysis.summary}</p>
          </section>

          {analysis.performance && analysis.performance.length > 0 ? (
            <section>
              <SectionTitle>Performance ({analysis.persona} lens)</SectionTitle>
              <div className="flex flex-col gap-2.5">
                {analysis.performance.map((item) => (
                  <ScoreBar key={item.label} label={item.label} score={item.score} max={100} />
                ))}
              </div>
            </section>
          ) : null}

          {analysis.technique && analysis.technique.length > 0 ? (
            <section>
              <SectionTitle>Sales Techniques</SectionTitle>
              <div className="flex flex-col gap-3">
                {analysis.technique.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-[10px] border border-[#e4e7eb] bg-white p-3"
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[12.5px] font-bold text-[#15171c]">
                        {item.label}
                      </span>
                      <span className="text-[12.5px] font-bold text-[#5b626d]">
                        {item.score ?? '—'}/10
                      </span>
                    </div>
                    <ScoreBar label="" score={item.score} max={10} compact />
                    {item.recommendation ? (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-[#5b626d]">
                        › {item.recommendation}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {analysis.strengths && analysis.strengths.length > 0 ? (
              <section>
                <SectionTitle>Strengths</SectionTitle>
                {analysis.strengths.map((s, i) => (
                  <Bullet key={i}>{s}</Bullet>
                ))}
              </section>
            ) : null}

            {analysis.weaknesses && analysis.weaknesses.length > 0 ? (
              <section>
                <SectionTitle>Weaknesses</SectionTitle>
                {analysis.weaknesses.map((w, i) => (
                  <Bullet key={i}>{w}</Bullet>
                ))}
              </section>
            ) : null}
          </div>

          {analysis.actionItems.length > 0 ? (
            <section>
              <SectionTitle>Action Items</SectionTitle>
              <div className="flex flex-col">
                {analysis.actionItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-3 border-b border-dashed border-[#d6dade] py-2.5 text-[12.5px] text-[#5b626d]"
                  >
                    <input
                      type="checkbox"
                      defaultChecked={item.done}
                      className="h-4 w-4 accent-[#15171c]"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  percent,
}: {
  label: string;
  value: string;
  percent: number;
}) {
  return (
    <div className="rounded-[10px] border border-[#e4e7eb] bg-white p-3.5">
      <div className="text-[22px] font-bold text-[#15171c]">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
        {label}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full border border-[#d6dade] bg-[#eceef1]">
        <span className="block h-full bg-[#15171c]" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  score,
  max,
  compact = false,
}: {
  label: string;
  score: number | null;
  max: number;
  compact?: boolean;
}) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-center justify-between text-[11.5px]">
          <span className="text-[#5b626d]">{label}</span>
          <b className="text-[#15171c]">
            {score ?? '—'}/{max}
          </b>
        </div>
      ) : null}
      <div
        className={[
          'overflow-hidden rounded-full border border-[#d6dade] bg-[#eceef1]',
          compact ? 'h-1.5' : 'h-2',
        ].join(' ')}
      >
        <span className="block h-full bg-[#15171c]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ratioPercent(ratio: string): number {
  const first = Number.parseInt(ratio.split('/')[0]?.trim() ?? '', 10);
  return Number.isFinite(first) ? Math.max(0, Math.min(100, first)) : 50;
}

function sentimentPercent(s: CallAnalysis['sentiment']): number {
  return s === 'Positive' ? 80 : s === 'Negative' ? 25 : 50;
}

function bandPercent(b: CallAnalysis['closeProbability']): number {
  return b === 'High' ? 80 : b === 'Low' ? 25 : 50;
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

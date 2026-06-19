import { GrowthCard, LiveDot } from '@/modules/(growth)/shared';

import type { CallAnalysis } from '../types';

type AfterSalesAnalysisPanelProps = {
  analyses: CallAnalysis[];
  selectedAnalysisId: string;
  onSelectAnalysis: (analysisId: string) => void;
  selectedAnalysis?: CallAnalysis;
};

export function AfterSalesAnalysisPanel({
  analyses,
  selectedAnalysisId,
  onSelectAnalysis,
  selectedAnalysis,
}: AfterSalesAnalysisPanelProps) {
  return (
    <GrowthCard title="After-Sales Analysis">
      <div className="grid min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-[10px] border border-[#e4e7eb]">
        <aside className="border-r border-[#e4e7eb]">
          <div className="border-b border-[#e4e7eb] p-3.5">
            <span className="rounded-full border border-[#15171c] bg-[#15171c] px-2.5 py-1 text-[9.5px] font-bold uppercase tracking-[0.06em] text-white">
              Recent calls · {analyses.length}
            </span>
          </div>

          {analyses.map((analysis) => {
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
                  {analysis.duration} · {analysis.sentiment} sentiment
                </div>
              </button>
            );
          })}
        </aside>

        <section className="p-5">
          {selectedAnalysis ? (
            <AnalysisDetail analysis={selectedAnalysis} />
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

function AnalysisDetail({ analysis }: { analysis: CallAnalysis }) {
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="Talk Ratio (Client / Saloot)" value={analysis.talkRatio} percent={72} />
        <MetricCard label="Sentiment" value={analysis.sentiment} percent={78} />
        <MetricCard label="Close Probability" value={analysis.closeProbability} percent={68} />
      </div>

      <section>
        <SectionTitle>Summary</SectionTitle>
        <p className="text-[13px] leading-relaxed text-[#5b626d]">
          {analysis.summary}
        </p>
      </section>

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
        <span
          className="block h-full bg-[#15171c]"
          style={{ width: `${percent}%` }}
        />
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
'use client';

import { useState } from 'react';

import { GrowthCard } from '@/modules/(growth)/shared';

// Settings (mock's `data-view="settings"`). Faithful to the saloot mock's `.set-grid`
// of four cards — Sender Identity, Sending Parameters, Integrations, Engine Mode —
// rendered inside the growth shell (the shared GrowthTopbar shows the "Settings"
// header). Fields are read-only displays; the integration / engine toggles flip
// locally (visual, like the mock) and aren't yet persisted to the backend.

export function SettingsUI() {
  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-[#959ca7]">
        Settings
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GrowthCard title="Sender Identity">
          <Field label="Sender name" value="Evertrust GmbH" />
          <Field label="Sender email" value="info@evertrust-germany.de" />
          <Field label="Signature" value="Evertrust GmbH · Growth Team" last />
        </GrowthCard>

        <GrowthCard title="Sending Parameters">
          <Field label="Daily send limit" value="120 emails / day" />
          <Field label="Sending hours" value="Mon–Fri · 08:00 – 17:00 CET" />
          <Field
            label="Follow-up spacing"
            value="Round 2: +4 days · Round 3: +9 days"
            last
          />
        </GrowthCard>

        <GrowthCard title="Integrations">
          <Toggle
            title="Gmail / Google Workspace"
            sub="Sending & inbox (Engage)"
            defaultOn
          />
          <Toggle
            title="Google Calendar"
            sub="Meeting Booker (Activate)"
            defaultOn
          />
          <Toggle
            title="Read AI"
            sub="After-sales call analysis (Activate)"
            defaultOn
          />
          <Toggle title="Google Sheets" sub="Lead export / CRM mirror" />
        </GrowthCard>

        <GrowthCard title="Engine Mode">
          <Toggle
            title="Approval before sending"
            sub="You confirm every email / list"
            defaultOn
          />
          <Toggle title="Auto-send" sub="Engine sends on its own" />
          <Toggle title="Weekly report" sub="Monday 08:00 by email" defaultOn />
        </GrowthCard>
      </div>
    </main>
  );
}

// Mock `.field`: a label over a read-only `.inp` display box.
function Field({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${last ? '' : 'mb-3.5'}`}>
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#959ca7]">
        {label}
      </span>
      <div className="rounded-[8px] border border-[#d6dade] bg-[#f6f7f9] px-[11px] py-[9px] text-[13px] text-[#15171c]">
        {value}
      </div>
    </div>
  );
}

// Mock `.toggle` + `.sw`: a labelled row with a flip switch (local visual state).
function Toggle({
  title,
  sub,
  defaultOn = false,
}: {
  title: string;
  sub: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center justify-between border-b border-dashed border-[#d6dade] py-[11px] last:border-b-0">
      <div>
        <div className="text-[12.5px] font-bold text-[#15171c]">{title}</div>
        <div className="text-[11px] text-[#959ca7]">{sub}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        onClick={() => setOn((v) => !v)}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-[20px] border transition-colors ${
          on ? 'border-[#15171c] bg-[#15171c]' : 'border-[#d6dade] bg-[#eceef1]'
        }`}
      >
        <span
          className={`absolute top-[2px] h-4 w-4 rounded-full transition-all ${
            on ? 'left-[18px] bg-white' : 'left-[2px] bg-[#959ca7]'
          }`}
        />
      </button>
    </div>
  );
}

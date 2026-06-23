'use client';

// Step 4 of R.E.A.N. — Nurture. Rebuilt to follow the marketing department's final
// UI/UX design (the saloot cockpit mock): white-themed, with two subtabs —
// Sales Pipeline (a six-stage kanban) and Contract Assist. Rendered INSIDE the
// growth shell (the (growth)/layout provides the sidebar + topbar), so this view
// owns neither the page title nor an <AppShell> — the shared GrowthTopbar renders
// the "Nurture" header (matches Activate/Reach/Engage).
import { useEffect, useMemo, useState } from 'react';
import type { CampaignDto } from '@evertrust/shared';
import { useRequirePermission } from '@/lib/permissions';
import { useCampaigns } from '@/hooks/use-campaigns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PipelineBoard } from './pipeline-board';
import { ContractAssist } from './contract-assist';

type Tab = 'pipeline' | 'contract';

function campaignLabel(c: CampaignDto): string {
  return c.name || c.project || c.nicheName || c.region;
}

export function NurtureUI() {
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      {isLoading ? (
        <div className="h-64 w-full animate-pulse rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9]" />
      ) : allowed ? (
        <NurtureView />
      ) : (
        <p className="text-[13px] font-bold text-[#959ca7]">Redirecting…</p>
      )}
    </main>
  );
}

function NurtureView() {
  const campaignsQ = useCampaigns();
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);

  const [tab, setTab] = useState<Tab>('pipeline');
  const [campaignId, setCampaignId] = useState<string | null>(null);

  // Default to the first ACTIVE campaign (or the first overall), keeping the
  // selection valid if it disappears from the list.
  useEffect(() => {
    const first = campaigns[0];
    if (!first) return;
    if (campaignId && campaigns.some((c) => c.id === campaignId)) return;
    const active = campaigns.find((c) => c.lifecycle === 'ACTIVE');
    setCampaignId((active ?? first).id);
  }, [campaigns, campaignId]);

  return (
    <div className="flex flex-col gap-4">
      {/* subtabs (design `.subtabs`) + campaign selector */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e4e7eb]">
        <div className="flex flex-wrap gap-0.5">
          <SubTab active={tab === 'pipeline'} onClick={() => setTab('pipeline')}>
            Sales Pipeline
          </SubTab>
          <SubTab active={tab === 'contract'} onClick={() => setTab('contract')}>
            Contract Assist
          </SubTab>
        </div>

        {campaigns.length > 0 ? (
          <div className="pb-2">
            <Select
              value={campaignId ?? undefined}
              onValueChange={setCampaignId}
            >
              <SelectTrigger className="h-8 w-[260px] border-[#d6dade] text-[12.5px]">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {campaignLabel(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {campaignsQ.isLoading ? (
        <div className="h-72 w-full animate-pulse rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9]" />
      ) : campaignsQ.isError ? (
        <p className="text-[13px] font-bold text-[#b91c1c]">
          Couldn’t load campaigns. {campaignsQ.error.message}
        </p>
      ) : campaigns.length === 0 ? (
        <EmptyPanel
          title="No campaigns yet"
          body="Create a campaign in Reach to start nurturing its pipeline."
        />
      ) : !campaignId ? (
        <EmptyPanel
          title="Pick a campaign"
          body="Choose a campaign above to see its pipeline."
        />
      ) : tab === 'pipeline' ? (
        <PipelineBoard campaignId={campaignId} />
      ) : (
        <ContractAssist campaignId={campaignId} />
      )}
    </div>
  );
}

// Design `.subtabs button` — underline tab, white-themed.
function SubTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        '-mb-px border-b-2 px-4 py-[11px] text-[13px] font-bold transition-colors',
        active
          ? 'border-[#15171c] text-[#15171c]'
          : 'border-transparent text-[#959ca7] hover:text-[#5b626d]',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-[#d6dade] bg-[#f6f7f9] px-6 py-12 text-center">
      <div className="text-[13px] font-bold text-[#15171c]">{title}</div>
      <div className="mt-1 text-[12.5px] text-[#959ca7]">{body}</div>
    </div>
  );
}

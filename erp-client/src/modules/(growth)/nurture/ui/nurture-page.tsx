'use client';

// Step 4 of R.E.A.N. — Nurture. Rebuilt to follow the marketing department's final
// UI/UX design (the saloot cockpit mock): white-themed, with two subtabs —
// Sales Pipeline (a six-stage kanban) and Contract Assist. Rendered INSIDE the
// growth shell (the (growth)/layout provides the sidebar + topbar), so this view
// owns neither the page title nor an <AppShell> — the shared GrowthTopbar renders
// the "Nurture" header (matches Activate/Reach/Engage).
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReachBoardLeadDto } from '@evertrust/shared';
import { useRequirePermission } from '@/lib/permissions';
import { useReachBoard } from '@/hooks/use-reach-board';
import { getReachCampaigns } from '@/modules/(growth)/reach/services/reach.service';
import type { ReachCampaignView } from '@/modules/(growth)/reach/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/modules/(growth)/shared';
import { PipelineBoard } from './pipeline-board';
import { ContractAssist } from './contract-assist';

type Tab = 'pipeline' | 'contract';

// The campaign Select's "show everything" sentinel — Radix Select can't hold an
// empty-string value, so we map this to `undefined` aimId (no filter). A "campaign"
// in Nurture is now a Reach AIM (reach_aims); its leads ARE the pipeline cards.
const ALL_CAMPAIGNS = '__all__';
const ALL_NICHES = '__all__';

type DatePreset = 'all' | '7' | '30' | '90';

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const PAGE_SIZE = 500;

function campaignLabel(c: ReachCampaignView): string {
  return c.name || c.niche || c.region;
}

export function NurtureUI() {
  const { allowed, isLoading } = useRequirePermission('campaigns:read');

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      {isLoading ? (
        <div className="flex h-64 w-full items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9]">
          <Spinner label="Loading…" />
        </div>
      ) : allowed ? (
        <NurtureView />
      ) : (
        <p className="text-[13px] font-bold text-[#959ca7]">Redirecting…</p>
      )}
    </main>
  );
}

function NurtureView() {
  // Nurture campaigns ARE Reach AIMs now (reach_aims). The selector + niche filter
  // read the aim list; the board reads that aim's leads.
  const campaignsQ = useQuery<ReachCampaignView[], Error>({
    queryKey: ['reach', 'aims', 'nurture'],
    queryFn: () => getReachCampaigns(),
  });
  const campaigns = useMemo(() => campaignsQ.data ?? [], [campaignsQ.data]);

  const [tab, setTab] = useState<Tab>('pipeline');
  const [campaignId, setCampaignId] = useState<string>(ALL_CAMPAIGNS);
  const [niche, setNiche] = useState<string>(ALL_NICHES);
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Default view is "All campaigns" (the full pipeline). If a specific campaign was
  // selected and later disappears from the list, fall back to All campaigns.
  useEffect(() => {
    if (
      campaignId !== ALL_CAMPAIGNS &&
      !campaigns.some((c) => c.id === campaignId)
    ) {
      setCampaignId(ALL_CAMPAIGNS);
    }
  }, [campaigns, campaignId]);

  // Debounce the search box (~300ms) before it hits the server-side `q` filter.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Distinct niches across the org's aims, for the niche Select.
  const niches = useMemo(() => {
    const set = new Set<string>();
    for (const c of campaigns) if (c.niche) set.add(c.niche);
    return [...set].sort();
  }, [campaigns]);

  // ALL_CAMPAIGNS means "All campaigns" (the board returns every org lead).
  const effectiveAimId =
    campaignId === ALL_CAMPAIGNS || campaignId == null ? undefined : campaignId;

  // The board fetches the same query; we re-read it here (React Query dedupes by
  // key) to apply the CLIENT-SIDE niche + date filters before the columns group.
  const boardQ = useReachBoard({
    aimId: effectiveAimId,
    q: search || undefined,
    limit: PAGE_SIZE,
    offset: 0,
  });

  const filteredItems = useMemo<ReachBoardLeadDto[]>(() => {
    const items = boardQ.data?.items ?? [];
    const cutoff =
      datePreset === 'all'
        ? null
        : Date.now() - Number(datePreset) * 24 * 60 * 60 * 1000;
    return items.filter((p) => {
      // Each lead carries its aim's niche (joined server-side).
      if (niche !== ALL_NICHES && p.niche !== niche) return false;
      if (cutoff != null) {
        const ts = Date.parse(p.createdAt);
        if (Number.isNaN(ts) || ts < cutoff) return false;
      }
      return true;
    });
  }, [boardQ.data, niche, datePreset]);

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
            <Select value={campaignId} onValueChange={setCampaignId}>
              <SelectTrigger className="h-8 w-[260px] border-[#d6dade] text-[12.5px]">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CAMPAIGNS}>All campaigns</SelectItem>
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

      {tab === 'pipeline' && campaigns.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={niche} onValueChange={setNiche}>
            <SelectTrigger className="h-8 w-[180px] border-[#d6dade] text-[12.5px]">
              <SelectValue placeholder="Niche" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_NICHES}>All niches</SelectItem>
              {niches.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={datePreset}
            onValueChange={(v) => setDatePreset(v as DatePreset)}
          >
            <SelectTrigger className="h-8 w-[150px] border-[#d6dade] text-[12.5px]">
              <SelectValue placeholder="Date" />
            </SelectTrigger>
            <SelectContent>
              {DATE_PRESETS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search company…"
            className="h-8 w-[220px] border-[#d6dade] text-[12.5px]"
          />
        </div>
      ) : null}

      {campaignsQ.isLoading ? (
        <div className="flex h-72 w-full items-center justify-center rounded-[10px] border border-[#e4e7eb] bg-[#f6f7f9]">
          <Spinner label="Loading campaigns…" />
        </div>
      ) : campaignsQ.isError ? (
        <p className="text-[13px] font-bold text-[#b91c1c]">
          Couldn’t load campaigns. {campaignsQ.error.message}
        </p>
      ) : campaigns.length === 0 ? (
        <EmptyPanel
          title="No campaigns yet"
          body="Create a campaign in Reach to start nurturing its pipeline."
        />
      ) : tab === 'pipeline' ? (
        <PipelineBoard
          aimId={effectiveAimId}
          q={search || undefined}
          items={filteredItems}
          campaigns={campaigns.map((c) => ({
            id: c.id,
            niche: c.niche,
            name: c.name,
          }))}
        />
      ) : !campaignId || campaignId === ALL_CAMPAIGNS ? (
        <EmptyPanel
          title="Pick a campaign"
          body="Choose a campaign above to use Contract Assist."
        />
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

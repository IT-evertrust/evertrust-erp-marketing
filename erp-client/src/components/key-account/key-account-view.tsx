'use client';

import { useMemo, useState } from 'react';
import {
  Bot,
  Calendar,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { LeadStageLabel, type LeadDto, type LeadStage } from '@evertrust/shared';
import {
  useClearLeads,
  useLeads,
  useLeadsBackfill,
  useRunHotLeadsPipeline,
} from '@/hooks/use-leads';
import { useCampaigns } from '@/hooks/use-campaigns';
import { Can } from '@/components/auth/can';
import { ConfirmButton } from '@/components/common/confirm-button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';
import { LeadDetailDialog } from './lead-detail-dialog';
import { AddLeadDialog } from './add-lead-dialog';

const ALL = 'all';

// Board columns, left → right pipeline. ARCHIVED leads are hidden from the board.
const COLUMNS: {
  stage: LeadStage;
  dot: string;
  sub: string;
}[] = [
  { stage: 'INTERESTED', dot: 'bg-emerald-400', sub: 'New + warming replies' },
  { stage: 'MEETING_SCHEDULED', dot: 'bg-amber-400', sub: 'Calls on the calendar' },
  { stage: 'ONGOING', dot: 'bg-sky-400', sub: 'Deals in progress' },
  { stage: 'CUSTOMER', dot: 'bg-violet-400', sub: 'Graduated to the CRM' },
];

// Tier → ribbon + pill colors (matches the mockup: AAA violet, AA sky, A emerald).
function tierStyle(tier: string | null): { ribbon: string; pill: string } | null {
  if (!tier) return null;
  const t = tier.trim().toUpperCase();
  if (t === 'AAA') return { ribbon: 'bg-violet-400', pill: 'bg-violet-400/15 text-violet-300' };
  if (t === 'AA') return { ribbon: 'bg-sky-400', pill: 'bg-sky-400/15 text-sky-300' };
  if (t === 'A') return { ribbon: 'bg-emerald-400', pill: 'bg-emerald-400/15 text-emerald-300' };
  return { ribbon: 'bg-muted-foreground', pill: 'bg-muted text-muted-foreground' };
}

const domainOf = (l: LeadDto) =>
  (l.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '') ||
  (l.email.includes('@') ? l.email.split('@')[1] : l.email);

// Key Account hot-lead CRM board (Interested → Meeting Scheduled → Ongoing →
// Customer), fed by the n8n Hot Leads Pipeline (Sync from n8n) + manual adds.
// Click a card to review it, change its stage, or graduate it to an ERP customer.
export function KeyAccountView() {
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [tier, setTier] = useState<string>(ALL);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<LeadDto | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const leads = useLeads({ campaignId: campaignId ?? undefined });
  const campaigns = useCampaigns();
  const backfill = useLeadsBackfill();
  const runPipeline = useRunHotLeadsPipeline();
  const clearLeads = useClearLeads();

  const list = leads.data ?? [];
  const campaignList = campaigns.data ?? [];

  // Tier options present in the data (so the filter only offers real tiers).
  const tiers = useMemo(
    () =>
      Array.from(
        new Set(list.map((l) => (l.tier || '').trim().toUpperCase()).filter(Boolean)),
      ).sort(),
    [list],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list.filter((l) => {
      if (tier !== ALL && (l.tier || '').trim().toUpperCase() !== tier) return false;
      if (needle) {
        const hay = `${l.companyName ?? ''} ${l.email} ${l.sourceCampaign ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [list, tier, q]);

  // KPIs — all derived from the real list (no fabricated metrics).
  const hot = list.filter((l) => l.stage === 'INTERESTED' || l.stage === 'MEETING_SCHEDULED' || l.stage === 'ONGOING').length;
  const meetings = list.filter((l) => !!l.meetingDate).length;
  const customers = list.filter((l) => l.stage === 'CUSTOMER').length;
  const active = list.filter((l) => l.stage !== 'ARCHIVED').length;
  const convPct = active > 0 ? Math.round((customers / active) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Key Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move hot leads through the pipeline — review, book, and graduate them to customers.
        </p>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi n={hot} label="Hot leads" tone="amber" />
        <Kpi n={meetings} label="Meetings booked" />
        <Kpi n={customers} label="Customers" tone="violet" />
        <Kpi n={`${convPct}%`} label="Lead → customer" />
        <Kpi n={campaignList.length} label="Live campaigns" />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5">
          {[ALL, ...tiers].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTier(t)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                tier === t
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === ALL ? 'All tiers' : t}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, email, niche…"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex flex-1" />
        <Select
          value={campaignId ?? ALL}
          onValueChange={(v) => setCampaignId(v === ALL ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All campaigns" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All campaigns</SelectItem>
            {campaignList.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || c.project}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Can permission="campaigns:write">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
            title="Import hot leads + graduated customers from n8n"
          >
            {backfill.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {backfill.isPending ? 'Syncing…' : 'Sync from n8n'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => runPipeline.mutate(campaignId ?? undefined)}
            disabled={runPipeline.isPending}
            title="Trigger the Hot Leads Pipeline in n8n"
          >
            {runPipeline.isPending ? <Loader2 className="animate-spin" /> : null}
            Run pipeline
          </Button>
          <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            Add lead
          </Button>
          <ConfirmButton
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Trash2 />
                Clear leads
              </Button>
            }
            title="Clear all leads?"
            description="Deletes every hot lead in this CRM (linked customers are kept). Test-data reset — this can't be undone."
            confirmLabel="Clear leads"
            pending={clearLeads.isPending}
            onConfirm={() => clearLeads.mutate()}
          />
        </Can>
      </div>

      {/* status / observability lines */}
      {leads.isError ? (
        <p className="text-sm text-destructive">Could not load leads: {leads.error.message}</p>
      ) : null}
      {backfill.isError ? (
        <p className="text-sm text-destructive">Sync failed: {backfill.error.message}</p>
      ) : backfill.data ? (
        <p className="text-xs text-muted-foreground">
          {backfill.data.configured
            ? `Synced from n8n — ${backfill.data.imported} lead${backfill.data.imported === 1 ? '' : 's'}, ${backfill.data.customers} new customer${backfill.data.customers === 1 ? '' : 's'} (scanned ${backfill.data.scanned}).`
            : 'n8n API not configured — set N8N_API_URL / N8N_API_KEY to sync.'}
        </p>
      ) : null}
      {runPipeline.data && !runPipeline.data.configured ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Hot Leads Pipeline webhook not configured (set N8N_HOT_LEADS_PIPELINE_WEBHOOK_URL).
        </p>
      ) : null}

      {/* board */}
      {leads.isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((c) => (
            <Skeleton key={c.stage} className="h-72 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3.5 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const cards = filtered.filter((l) => l.stage === col.stage);
            return (
              <div
                key={col.stage}
                className="flex flex-col rounded-2xl border bg-card/40"
              >
                <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
                  <span className={cn('size-2.5 rounded-full', col.dot)} />
                  <span className="text-sm font-semibold">{LeadStageLabel[col.stage]}</span>
                  <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
                    {cards.length}
                  </span>
                </div>
                <p className="-mt-1 px-4 pb-2.5 text-[11px] text-muted-foreground">{col.sub}</p>
                <div className="flex flex-col gap-2.5 px-3 pb-3.5">
                  {cards.map((lead) => (
                    <LeadCard key={lead.id} lead={lead} onClick={() => setSelected(lead)} />
                  ))}
                  <Can permission="campaigns:write">
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      className="rounded-xl border border-dashed py-2.5 text-center text-xs text-muted-foreground transition-colors hover:border-foreground/25 hover:text-foreground"
                    >
                      + add lead
                    </button>
                  </Can>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LeadDetailDialog lead={selected} onOpenChange={(open) => !open && setSelected(null)} />
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function Kpi({
  n,
  label,
  tone,
}: {
  n: number | string;
  label: string;
  tone?: 'amber' | 'violet';
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <div
        className={cn(
          'text-2xl font-bold tracking-tight tabular-nums',
          tone === 'amber' && 'text-amber-400',
          tone === 'violet' && 'text-violet-400',
        )}
      >
        {n}
      </div>
      <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function LeadCard({ lead, onClick }: { lead: LeadDto; onClick: () => void }) {
  const ts = tierStyle(lead.tier);
  const location = [lead.city, lead.country].filter(Boolean).join(', ');
  const reason = lead.hotReason || lead.leadStatus || lead.note;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative rounded-xl border bg-background py-3 pl-4 pr-3.5 text-left transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-lg hover:shadow-black/20"
    >
      {ts ? (
        <span className={cn('absolute bottom-3 left-0 top-3 w-[3px] rounded-full', ts.ribbon)} />
      ) : null}
      <div className="flex items-center gap-2">
        <span className="truncate text-[13.5px] font-semibold tracking-tight">
          {lead.companyName || lead.email}
        </span>
        {lead.tier && ts ? (
          <span className={cn('ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold', ts.pill)}>
            {lead.tier}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{domainOf(lead)}</div>

      {location ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
            <MapPin className="size-3" />
            {location}
          </span>
        </div>
      ) : null}

      {reason ? (
        <p className="mt-2 line-clamp-2 border-t pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {reason}
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-muted-foreground/70">
        {lead.meetingDate ? (
          <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
            <Calendar className="size-3" />
            {lead.meetingDate}
          </span>
        ) : lead.sourceCampaign ? (
          <span className="truncate">{lead.sourceCampaign}</span>
        ) : null}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          {lead.source === 'N8N' ? <Bot className="size-3" /> : <User className="size-3" />}
          {lead.source === 'N8N' ? 'n8n' : 'manual'}
          {lead.detectedAt ? ` · ${formatDateTime(lead.detectedAt)}` : ''}
        </span>
      </div>
    </button>
  );
}

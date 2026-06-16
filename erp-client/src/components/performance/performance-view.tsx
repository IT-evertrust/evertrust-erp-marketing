'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClock, Building2, Loader2, Plus, Sparkles, Trophy } from 'lucide-react';
import {
  bonusTierForScore,
  type Department,
  type KpiCategory,
  type PerformanceOverviewDto,
  type ScorecardDto,
  type ScorecardZone,
} from '@evertrust/shared';
import {
  useBrief,
  useGenerateBrief,
  useOverview,
  useScorecards,
} from '@/hooks/use-performance';
import { Can } from '@/components/auth/can';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page-header';
import { RecordKpiDialog } from './record-kpi-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Zone → presentation. Hex is used for the conic-gradient ring + bars (inline
// styles, so Tailwind's JIT can't drop them); classes for text/bg chips.
const ZONE: Record<
  ScorecardZone,
  { hex: string; text: string; chip: string }
> = {
  GREEN: { hex: '#34d399', text: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-400' },
  YELLOW: { hex: '#fbbf24', text: 'text-amber-400', chip: 'bg-amber-500/15 text-amber-400' },
  ORANGE: { hex: '#fb923c', text: 'text-orange-400', chip: 'bg-orange-500/15 text-orange-400' },
  RED: { hex: '#f87171', text: 'text-red-400', chip: 'bg-red-500/15 text-red-400' },
};
const CATS: KpiCategory[] = ['OUTPUT', 'QUALITY', 'SPEED', 'COMPLIANCE', 'REVENUE'];
// next-intl's typed `t` is parameterised; a loose alias keeps the helper
// signatures readable without importing the generated message shape.
type T = ReturnType<typeof useTranslations>;
const initials = (n: string) =>
  n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const deptLabel = (d: ScorecardDto['department'], t: T) =>
  d ? t(`department.${d as Department}`) : t('unassigned');
// bonusTierForScore returns a localisable pct (100/75/50/0); map it to a key.
const bonusKey = (pct: number) =>
  pct >= 100 ? 'full' : pct >= 75 ? 'pct75' : pct >= 50 ? 'pct50' : 'none';

function Ring({ score, size = 60 }: { score: number; size?: number }) {
  const z = ZONE[scoreZone(score)];
  const inner = size - 14;
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{ width: size, height: size, background: `conic-gradient(${z.hex} ${score}%, var(--muted) 0)` }}
    >
      <div
        className="absolute rounded-full bg-card"
        style={{ width: inner, height: inner }}
      />
      <b className={cn('relative text-base font-bold tabular-nums', z.text)}>{score}</b>
    </div>
  );
}
function scoreZone(s: number): ScorecardZone {
  if (s >= 90) return 'GREEN';
  if (s >= 75) return 'YELLOW';
  if (s >= 60) return 'ORANGE';
  return 'RED';
}

// `hideHeader` suppresses the internal PageHeader masthead when the view is
// embedded under another page that already supplies one (e.g. the Analytics
// page renders this as its "Team scorecards" section).
export function PerformanceView({ hideHeader = false }: { hideHeader?: boolean }) {
  const t = useTranslations('performance');
  const scorecards = useScorecards('WEEKLY');
  const overview = useOverview('WEEKLY');
  const [selected, setSelected] = useState<ScorecardDto | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  // Tab is URL-synced (#executive) so it deep-links and survives a re-mount
  // (e.g. the permission query refetching on window refocus).
  const [tab, setTab] = useState<string>(() =>
    typeof window !== 'undefined' && window.location.hash === '#executive'
      ? 'executive'
      : 'scorecards',
  );
  const onTab = (v: string) => {
    setTab(v);
    if (typeof window !== 'undefined') {
      history.replaceState(null, '', v === 'executive' ? '#executive' : '#');
    }
  };

  const cards = scorecards.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      {hideHeader ? null : (
        <PageHeader title={t('title')} description={t('description')} />
      )}

      {scorecards.isError ? (
        <p className="text-sm text-destructive">
          {t('loadError', { message: scorecards.error.message })}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={onTab} className="flex flex-col gap-5">
        <TabsList>
          <TabsTrigger value="scorecards">{t('tabs.scorecards')}</TabsTrigger>
          <TabsTrigger value="executive">{t('tabs.executive')}</TabsTrigger>
        </TabsList>

        {/* ---- Layout B: leaderboard + scorecard drawer ---- */}
        <TabsContent value="scorecards" className="flex flex-col gap-5">
          {scorecards.isLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : cards.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <Can permission="performance:write">
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setRecordOpen(true)}>
                    <Plus /> {t('recordKpi')}
                  </Button>
                </div>
              </Can>
              <Callouts cards={cards} />
              <div className="overflow-hidden rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">{t('table.rank')}</TableHead>
                      <TableHead>{t('table.employee')}</TableHead>
                      <TableHead>{t('table.team')}</TableHead>
                      <TableHead>{t('table.score')}</TableHead>
                      <TableHead>{t('table.zone')}</TableHead>
                      <TableHead className="hidden md:table-cell">{t('table.categories')}</TableHead>
                      <TableHead>{t('table.bonus')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cards.map((c, i) => {
                      const z = ZONE[c.zone];
                      return (
                        <TableRow
                          key={c.userId}
                          className="cursor-pointer"
                          onClick={() => setSelected(c)}
                        >
                          <TableCell className="font-bold tabular-nums text-muted-foreground">
                            {i + 1}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span
                                className={cn(
                                  'grid size-8 place-items-center rounded-lg text-[11px] font-bold',
                                  z.chip,
                                )}
                              >
                                {initials(c.userName)}
                              </span>
                              <div>
                                <div className="font-medium">{c.userName}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {c.position ?? '—'}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-[12.5px] text-muted-foreground">
                            {deptLabel(c.department, t)}
                          </TableCell>
                          <TableCell className={cn('text-base font-bold tabular-nums', z.text)}>
                            {c.composite}
                          </TableCell>
                          <TableCell>
                            <span className={cn('rounded-full px-2.5 py-0.5 text-[10.5px] font-bold', z.chip)}>
                              {t(`zone.${c.zone}`)}
                            </span>
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="flex items-end gap-1">
                              {CATS.map((cat) => {
                                const v = c.categoryScores?.[cat];
                                return (
                                  <span
                                    key={cat}
                                    title={`${t(`category.${cat}`)}: ${v ?? '—'}`}
                                    className="w-2 rounded-sm bg-muted"
                                    style={{ height: 22 }}
                                  >
                                    <span
                                      className="block w-full rounded-sm"
                                      style={{
                                        height: `${((v ?? 0) / 100) * 22}px`,
                                        background: v == null ? 'transparent' : ZONE[scoreZone(v)].hex,
                                        marginTop: `${22 - ((v ?? 0) / 100) * 22}px`,
                                      }}
                                    />
                                  </span>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell className="text-[12.5px] text-muted-foreground">
                            {t(`bonus.${bonusKey(bonusTierForScore(c.composite).pct)}`)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </TabsContent>

        {/* ---- Layout C: executive cockpit ---- */}
        <TabsContent value="executive" className="flex flex-col gap-5">
          {overview.isLoading ? (
            <Skeleton className="h-72 w-full rounded-xl" />
          ) : overview.data ? (
            <ExecutiveTab data={overview.data} />
          ) : (
            <EmptyState />
          )}
        </TabsContent>
      </Tabs>

      <ScorecardDialog card={selected} onOpenChange={(o) => !o && setSelected(null)} />
      <RecordKpiDialog cards={cards} open={recordOpen} onOpenChange={setRecordOpen} />
    </div>
  );
}

function Callouts({ cards }: { cards: ScorecardDto[] }) {
  const t = useTranslations('performance');
  const top = cards.slice(0, 3);
  const bottom = cards.slice(-2).reverse();
  const Chip = ({ c }: { c: ScorecardDto }) => {
    const z = ZONE[c.zone];
    return (
      <span className="inline-flex items-center gap-2 rounded-full border bg-muted/40 py-1 pl-1 pr-3 text-[12.5px]">
        <span className={cn('grid size-5 place-items-center rounded-full text-[9px] font-bold', z.chip)}>
          {initials(c.userName)}
        </span>
        {c.userName.split(' ')[0]} <b className={cn('tabular-nums', z.text)}>{c.composite}</b>
      </span>
    );
  };
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-xl border border-l-2 border-l-emerald-500 bg-card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Trophy className="size-3.5 text-emerald-400" /> {t('callouts.topPerformers')}
        </div>
        <div className="flex flex-wrap gap-2">{top.map((c) => <Chip key={c.userId} c={c} />)}</div>
      </div>
      <div className="rounded-xl border border-l-2 border-l-red-500 bg-card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <AlarmClock className="size-3.5 text-red-400" /> {t('callouts.needsReview')}
        </div>
        <div className="flex flex-wrap gap-2">{bottom.map((c) => <Chip key={c.userId} c={c} />)}</div>
      </div>
    </div>
  );
}

function ScorecardDialog({
  card,
  onOpenChange,
}: {
  card: ScorecardDto | null;
  onOpenChange: (o: boolean) => void;
}) {
  const t = useTranslations('performance');
  return (
    <Dialog open={!!card} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-auto sm:max-w-lg">
        {card ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-4">
                <Ring score={card.composite} size={72} />
                <div>
                  <DialogTitle>{card.userName}</DialogTitle>
                  <DialogDescription>
                    {[card.position, deptLabel(card.department, t)].filter(Boolean).join(' · ')}
                  </DialogDescription>
                  <span className={cn('mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold', ZONE[card.zone].chip)}>
                    {t(`zone.${card.zone}`)} · {t(`bonus.${bonusKey(bonusTierForScore(card.composite).pct)}`)}
                  </span>
                </div>
              </div>
            </DialogHeader>

            <div className="mt-1">
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('scorecardDialog.kpiCategories')}
              </div>
              <div className="flex flex-col gap-1.5">
                {CATS.map((cat) => {
                  const v = card.categoryScores?.[cat];
                  return (
                    <div key={cat} className="grid grid-cols-[90px_1fr_30px] items-center gap-2 text-[12px]">
                      <span className="text-muted-foreground">{t(`category.${cat}`)}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${v ?? 0}%`, background: v == null ? 'transparent' : ZONE[scoreZone(v)].hex }}
                        />
                      </span>
                      <span className="text-right tabular-nums text-muted-foreground">{v ?? '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('scorecardDialog.kpisHeading')}
              </div>
              <div className="flex flex-col">
                {card.kpis.map((k) => (
                  <div key={k.key} className="flex items-center gap-2.5 border-b py-2 text-[12.5px] last:border-0">
                    <span className={cn('w-16 shrink-0 rounded text-center text-[9px] font-bold', srcChip(k.source))}>
                      {k.source === 'NA' ? t('scorecardDialog.noData') : k.source}
                    </span>
                    <span className="flex-1">{k.label}</span>
                    <span className={cn('font-bold tabular-nums', k.value == null && 'text-muted-foreground')}>
                      {k.value ?? '—'}
                    </span>
                    <span className="w-16 text-right text-[11px] text-muted-foreground">
                      {t('scorecardDialog.target', { value: k.target ?? '—' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function srcChip(s: string): string {
  if (s === 'AUTO') return 'bg-emerald-500/15 text-emerald-400';
  if (s === 'MANUAL') return 'bg-sky-500/15 text-sky-400';
  if (s === 'PARTIAL') return 'bg-amber-500/15 text-amber-400';
  return 'bg-muted text-muted-foreground';
}

function ExecutiveTab({ data }: { data: PerformanceOverviewDto }) {
  const t = useTranslations('performance');
  const Kpi = ({ n, l, tone }: { n: number | string; l: string; tone?: string }) => (
    <div className="rounded-xl border bg-card px-4 py-3.5">
      <div className={cn('text-2xl font-bold tabular-nums', tone)}>{n}</div>
      <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{l}</div>
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi n={data.companyAvg} l={t('executive.companyAvg')} />
        <Kpi n={data.members} l={t('executive.membersScored')} />
        <Kpi n={data.highPerformers} l={t('executive.highPerformers')} tone="text-emerald-400" />
        <Kpi n={data.needsAttention} l={t('executive.needAttention')} tone="text-red-400" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Building2 className="size-3.5" /> {t('executive.departmentHealth')}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.departments.map((d) => {
              const z = ZONE[scoreZone(d.avg)];
              return (
                <div key={d.label} className="rounded-lg border bg-background p-3" style={{ borderLeft: `2px solid ${z.hex}` }}>
                  <div className="text-[13px] font-medium">{d.label}</div>
                  <div className="mt-1 flex items-end gap-2">
                    <span className={cn('text-xl font-bold tabular-nums', z.text)}>{d.avg}</span>
                    <span className="mb-0.5 text-[11px] text-muted-foreground">
                      {t('executive.deptMeta', { count: d.count, top: d.topName?.split(' ')[0] ?? '—' })}
                    </span>
                  </div>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${d.avg}%`, background: z.hex }} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <AlarmClock className="size-3.5" /> {t('executive.needsAttention')}
          </div>
          <div className="flex flex-col gap-2">
            {data.attention.map((c) => {
              const z = ZONE[c.zone];
              return (
                <div key={c.userId} className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2">
                  <span className={cn('grid size-8 place-items-center rounded-lg text-[11px] font-bold', z.chip)}>
                    {initials(c.userName)}
                  </span>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium">{c.userName}</div>
                    <div className="text-[11px] text-muted-foreground">{deptLabel(c.department, t)}</div>
                  </div>
                  <span className={cn('text-base font-bold tabular-nums', z.text)}>{c.composite}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <BriefPanel />
    </div>
  );
}

function BriefPanel() {
  const t = useTranslations('performance');
  const brief = useBrief('WEEKLY');
  const gen = useGenerateBrief('WEEKLY');
  const data = brief.data;
  const summary = data?.summary ?? null;
  const configured = data?.configured ?? false;
  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.04] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-400">
          <Sparkles className="size-3.5" /> {t('brief.title')}
        </div>
        {data?.generatedAt ? (
          <span className="text-[11px] text-muted-foreground">
            {t('brief.generatedAt', { date: new Date(data.generatedAt).toLocaleString() })}
          </span>
        ) : null}
        <Can permission="performance:write">
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => gen.mutate()}
            disabled={gen.isPending || !configured}
            title={configured ? '' : t('brief.enableTooltip')}
          >
            {gen.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {summary ? t('brief.regenerate') : t('brief.generate')}
          </Button>
        </Can>
      </div>
      {!configured ? (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t.rich('brief.notConfigured', {
            code: (chunks) => <code className="rounded bg-muted px-1">{chunks}</code>,
          })}
        </p>
      ) : summary ? (
        <>
          <p className="text-[13.5px] font-medium">{summary.headline}</p>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[12.5px] text-muted-foreground">
            {summary.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
          <div className="mt-3 rounded-lg border bg-card p-3 text-[12.5px]">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-violet-400">
              {t('brief.topAction')}
            </div>
            {summary.topAction}
          </div>
        </>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">
          {t('brief.empty')}
        </p>
      )}
      {gen.isError ? (
        <p className="mt-2 text-xs text-destructive">{gen.error.message}</p>
      ) : null}
    </div>
  );
}

function EmptyState() {
  const t = useTranslations('performance');
  return (
    <div className="rounded-xl border border-dashed bg-card/40 p-10 text-center">
      <p className="text-sm font-medium">{t('emptyState.title')}</p>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        {t('emptyState.description')}
      </p>
    </div>
  );
}

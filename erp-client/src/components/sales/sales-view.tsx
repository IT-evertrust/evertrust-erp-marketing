'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  ChevronRight,
  ExternalLink,
  FolderOpen,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MeetingDto } from '@evertrust/shared';
import {
  useAnalyzeMeeting,
  useDeleteMeeting,
  useLinkMeeting,
  useMeetings,
  useSyncMeetings,
} from '@/hooks/use-meetings';
import { usePersonas } from '@/hooks/use-personas';
import { useCampaigns } from '@/hooks/use-campaigns';
import { PageHeader } from '@/components/common/page-header';
import { Can } from '@/components/auth/can';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tender-format';

const ALL = 'all';
const NONE = 'none';

// Local view of the workflow's Sales Analysis Schema (stored as jsonb). Read
// defensively — the LLM output can drift.
interface Score {
  score?: number | null;
  rationale?: string | null;
}
interface Item {
  moment?: string;
  area?: string;
  timestamp?: string;
  why_effective?: string;
  observation?: string;
  evidence_quote?: string;
  suggestion?: string;
  methodology?: { source?: string; pattern?: string };
}
interface Analysis {
  overall_summary?: string;
  strengths?: Item[];
  weaknesses?: Item[];
  performance_score?: Record<string, Score>;
  client_analysis?: Record<string, Score>;
  // Drive-synced rows carry the sheet's flattened text (no structured arrays).
  strengths_text?: string;
  weaknesses_text?: string;
}

// Score dimensions, keyed by the analysis-schema field. Labels are resolved at
// render time via the `sales` namespace (detail.perf.* / detail.client.*).
const PERF = [
  'understanding_client_needs',
  'communication',
  'technical_explanation',
  'aggressiveness',
] as const;
const CLIENT = ['buying_intent', 'interest', 'communication'] as const;

const scoreClass = (s: number) =>
  s >= 70
    ? 'text-emerald-600 dark:text-emerald-400'
    : s >= 50
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-red-600 dark:text-red-400';
const barClass = (s: number) =>
  s >= 70 ? 'bg-emerald-500' : s >= 50 ? 'bg-amber-500' : 'bg-red-500';
const campName = (
  c: { name?: string | null; project?: string | null },
  fallback: string,
) => c.name || c.project || fallback;

// Sales page: meetings synced from the EVERTRUST - SALES AGENT n8n workflow,
// each attributed to its campaign (prospect email → lead). Search + Campaign /
// AE / Persona / Date filters; detail shows the Hormozi analysis + lets you
// manually link an unattributed meeting.
export function SalesView() {
  const t = useTranslations('sales');
  const meetings = useMeetings();
  const sync = useSyncMeetings();
  const link = useLinkMeeting();
  const campaigns = useCampaigns();
  const campList = campaigns.data ?? [];
  const all = meetings.data ?? [];

  const [search, setSearch] = useState('');
  const [fCampaign, setFCampaign] = useState(ALL);
  const [fAe, setFAe] = useState(ALL);
  const [fPersona, setFPersona] = useState(ALL);
  const [bucket, setBucket] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  const aes = useMemo(
    () => [...new Set(all.map((m) => m.aeName).filter(Boolean))] as string[],
    [all],
  );
  const personas = useMemo(
    () => [...new Set(all.map((m) => m.persona).filter(Boolean))] as string[],
    [all],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    const cut =
      bucket === 'week'
        ? now - 7 * 864e5
        : bucket === 'month'
          ? now - 30 * 864e5
          : null;
    return all.filter((m) => {
      if (fCampaign === NONE && m.campaignId) return false;
      if (fCampaign !== ALL && fCampaign !== NONE && m.campaignId !== fCampaign)
        return false;
      if (fAe !== ALL && m.aeName !== fAe) return false;
      if (fPersona !== ALL && m.persona !== fPersona) return false;
      if (cut !== null) {
        const t = new Date(m.meetingDate ?? m.createdAt).getTime();
        if (Number.isFinite(t) && t < cut) return false;
      }
      if (q) {
        const hay = [m.clientCompany, m.aeName, m.clientContact, m.clientEmail]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, search, fCampaign, fAe, fPersona, bucket]);

  const selected =
    all.find((m) => m.id === selectedId) ?? filtered[0] ?? all[0] ?? null;

  function select(id: string) {
    setSelectedId(id);
    setChanging(false);
    setLinkValue('');
  }
  function doSync() {
    sync.mutate(undefined, {
      onSuccess: (r) =>
        r.configured
          ? toast.success(
              t('syncToast', {
                imported: r.imported,
                updated: r.updated,
                pruned: r.pruned,
                scanned: r.scanned,
              }),
            )
          : toast.error(t('syncNotConfigured')),
      onError: (e) => toast.error(e.message ?? t('syncError')),
    });
  }
  function doLink(mtg: MeetingDto, campaignId: string | null) {
    link.mutate(
      { id: mtg.id, campaignId },
      {
        onSuccess: () => {
          toast.success(
            campaignId ? t('linkedToast') : t('clearedToast'),
          );
          setChanging(false);
        },
        onError: (e) => toast.error(e.message ?? t('linkError')),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('header.title')}
        description={t('header.description')}
        actions={
          <Can permission="campaigns:write">
            <Button
              variant="outline"
              size="sm"
              onClick={doSync}
              disabled={sync.isPending}
            >
              {sync.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              {sync.isPending ? t('syncing') : t('sync')}
            </Button>
          </Can>
        }
      />

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('filters.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-full sm:w-60"
        />
        <Select value={fCampaign} onValueChange={setFCampaign}>
          <SelectTrigger className="h-9 w-[190px]">
            <SelectValue placeholder={t('filters.campaignPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allCampaigns')}</SelectItem>
            {campList.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {campName(c, t('list.campaignFallback'))}
              </SelectItem>
            ))}
            <SelectItem value={NONE}>{t('filters.unattributed')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={fAe} onValueChange={setFAe}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder={t('filters.aePlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allAes')}</SelectItem>
            {aes.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={fPersona} onValueChange={setFPersona}>
          <SelectTrigger className="h-9 w-[160px]">
            <SelectValue placeholder={t('filters.personaPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('filters.allPersonas')}</SelectItem>
            {personas.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              [ALL, t('filters.anyTime')],
              ['week', t('filters.week')],
              ['month', t('filters.month')],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setBucket(k)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                bucket === k
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {meetings.isError ? (
        <p className="text-sm text-destructive">
          {t('list.loadError', { message: meetings.error.message })}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
          {/* list */}
          <Card className="self-start overflow-hidden">
            <div className="border-b p-3 text-xs uppercase tracking-wider text-muted-foreground">
              {t('list.heading', { count: filtered.length })}
            </div>
            <div className="max-h-[72vh] overflow-y-auto">
              {meetings.isLoading ? (
                <div className="flex flex-col gap-2 p-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {all.length === 0 ? t('list.emptyNoData') : t('list.empty')}
                </p>
              ) : (
                filtered.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => select(m.id)}
                    className={cn(
                      'flex w-full flex-col gap-1.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50',
                      selected?.id === m.id && 'bg-muted',
                    )}
                  >
                    <span className="truncate text-sm font-semibold">
                      {m.clientCompany ?? t('list.unknownCompany')}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.aeName ?? '—'} → {m.clientContact ?? '—'} ·{' '}
                      {m.meetingDate ?? formatDateTime(m.createdAt)}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.campaignId ? (
                        <Badge className="gap-1 border-transparent bg-sky-500/10 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                          {m.campaignName ?? t('list.campaignFallback')}
                        </Badge>
                      ) : (
                        <Badge className="gap-1 border-transparent bg-amber-500/10 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          {t('list.unattributed')}
                        </Badge>
                      )}
                      {typeof m.score === 'number' ? (
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', scoreClass(m.score))}
                        >
                          {t('list.score', { score: m.score })}
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Card>

          {/* detail */}
          <Card>
            <CardContent className="pt-6">
              {meetings.isLoading ? (
                <Skeleton className="h-80 w-full" />
              ) : !selected ? (
                <p className="text-sm text-muted-foreground">
                  {t('detail.none')}
                </p>
              ) : (
                <MeetingDetail
                  key={selected.id}
                  m={selected}
                  campList={campList}
                  changing={changing}
                  setChanging={setChanging}
                  linkValue={linkValue}
                  setLinkValue={setLinkValue}
                  onLink={doLink}
                  linking={link.isPending}
                  onDeleted={() => setSelectedId(null)}
                />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function MeetingDetail({
  m,
  campList,
  changing,
  setChanging,
  linkValue,
  setLinkValue,
  onLink,
  linking,
  onDeleted,
}: {
  m: MeetingDto;
  campList: { id: string; name?: string | null; project?: string | null }[];
  changing: boolean;
  setChanging: (v: boolean) => void;
  linkValue: string;
  setLinkValue: (v: string) => void;
  onLink: (m: MeetingDto, campaignId: string | null) => void;
  linking: boolean;
  onDeleted: () => void;
}) {
  const t = useTranslations('sales');
  const a = (m.analysis ?? null) as Analysis | null;
  const showPicker = !m.campaignId || changing;

  const personas = usePersonas();
  const personaList = personas.data?.personas ?? [];
  const folderUrl = personas.data?.folderUrl ?? null;
  const analyze = useAnalyzeMeeting();
  const del = useDeleteMeeting();
  const [confirmDel, setConfirmDel] = useState(false);
  const [personaSel, setPersonaSel] = useState('');
  const personaName =
    personaSel ||
    (m.persona && personaList.some((p) => p.name === m.persona)
      ? m.persona
      : '') ||
    personaList[0]?.name ||
    '';

  return (
    <div className="flex flex-col gap-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {m.clientCompany ?? t('detail.unknownCompany')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {m.aeName ?? '—'} → {m.clientContact ?? '—'} ·{' '}
            {m.meetingDate ?? formatDateTime(m.createdAt)}
            {m.persona ? ` · ${m.persona}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {m.docUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={m.docUrl} target="_blank" rel="noopener noreferrer">
                {t('detail.openDoc')}{' '}
                <ExternalLink className="ml-1 size-3.5" />
              </a>
            </Button>
          ) : null}
          <Can permission="campaigns:write">
            <Button
              variant={confirmDel ? 'destructive' : 'ghost'}
              size="sm"
              disabled={del.isPending}
              onClick={() => {
                if (!confirmDel) {
                  setConfirmDel(true);
                  return;
                }
                del.mutate(m.id, {
                  onSuccess: () => {
                    toast.success(t('detail.deleteToast'));
                    onDeleted();
                  },
                  onError: (e) =>
                    toast.error(e.message ?? t('detail.deleteError')),
                });
              }}
              onMouseLeave={() => setConfirmDel(false)}
              title={t('detail.deleteTitle')}
            >
              {del.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {confirmDel ? t('detail.confirmDelete') : t('detail.delete')}
            </Button>
          </Can>
        </div>
      </div>

      {/* attribution */}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm',
          m.campaignId
            ? 'border-sky-500/30 bg-sky-500/5'
            : 'border-amber-500/30 bg-amber-500/5',
        )}
      >
        {showPicker ? (
          <>
            <span className="text-muted-foreground">
              {m.campaignId
                ? t('detail.attribution.changeCampaign')
                : m.clientEmail
                  ? t('detail.attribution.unattributedNoMatch', {
                      email: m.clientEmail,
                    })
                  : t('detail.attribution.unattributedNoEmail')}
            </span>
            <Select value={linkValue} onValueChange={setLinkValue}>
              <SelectTrigger className="h-8 w-[200px]">
                <SelectValue
                  placeholder={t('detail.attribution.choosePlaceholder')}
                />
              </SelectTrigger>
              <SelectContent>
                {campList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name ||
                      c.project ||
                      t('detail.attribution.campaignFallback')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!linkValue || linking}
              onClick={() => onLink(m, linkValue)}
            >
              {t('detail.attribution.link')}
            </Button>
            {m.campaignId ? (
              <Button size="sm" variant="ghost" onClick={() => setChanging(false)}>
                {t('detail.attribution.cancel')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">
              {t('detail.attribution.campaign')}
            </span>
            <span className="font-medium">
              {m.campaignName ?? t('detail.attribution.campaignName')}
            </span>
            {m.matchMethod ? (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                {t('detail.attribution.matchedBy', { method: m.matchMethod })}
              </Badge>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-xs"
              onClick={() => {
                setLinkValue(m.campaignId ?? '');
                setChanging(true);
              }}
            >
              {t('detail.attribution.change')}
            </Button>
          </>
        )}
      </div>

      {/* signals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Signal k={t('detail.signals.ae')} v={m.aeName ?? '—'} />
        <Signal
          k={t('detail.signals.clientContact')}
          v={m.clientContact ?? '—'}
        />
        <Signal
          k={t('detail.signals.prospectEmail')}
          v={m.clientEmail ?? '—'}
        />
        <Signal
          k={t('detail.signals.overallScore')}
          v={
            typeof m.score === 'number'
              ? t('detail.signals.scoreValue', { score: m.score })
              : '—'
          }
        />
      </div>

      {/* coaching: persona + analyze */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          {t('detail.coaching.persona')}
        </span>
        <Select value={personaName} onValueChange={setPersonaSel}>
          <SelectTrigger className="h-8 w-[200px]">
            <SelectValue
              placeholder={
                personas.isLoading
                  ? t('detail.coaching.loadingPersona')
                  : t('detail.coaching.choosePersona')
              }
            />
          </SelectTrigger>
          <SelectContent>
            {personaList.map((p) => (
              <SelectItem key={p.id} value={p.name}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          title={t('detail.coaching.refreshPersonas')}
          disabled={personas.isFetching}
          onClick={() => void personas.refetch()}
        >
          <RefreshCw
            className={cn('size-3.5', personas.isFetching && 'animate-spin')}
          />
        </Button>
        {folderUrl ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            title={t('detail.coaching.openFolder')}
          >
            <a href={folderUrl} target="_blank" rel="noopener noreferrer">
              <FolderOpen className="size-3.5" /> {t('detail.coaching.folder')}
            </a>
          </Button>
        ) : null}
        <Can permission="campaigns:write">
          <Button
            size="sm"
            disabled={!personaName || !m.hasTranscript || analyze.isPending}
            onClick={() =>
              analyze.mutate(
                { id: m.id, persona: personaName },
                {
                  onSuccess: () => toast.success(t('detail.coaching.analyzeToast')),
                  onError: (e) =>
                    toast.error(e.message ?? t('detail.coaching.analyzeError')),
                },
              )
            }
          >
            {analyze.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {m.analysis
              ? t('detail.coaching.reanalyze')
              : t('detail.coaching.analyze')}
          </Button>
        </Can>
        {!m.hasTranscript ? (
          <span className="text-xs text-muted-foreground">
            {t('detail.coaching.noTranscript')}
          </span>
        ) : null}
      </div>

      {/* analysis */}
      {!a ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('detail.analysis.none')}
        </p>
      ) : (
        <>
          {a.overall_summary ? (
            <div>
              <SectionLabel>{t('detail.analysis.summary')}</SectionLabel>
              <p className="border-l-2 border-sky-500 pl-3 text-sm text-foreground/90">
                {a.overall_summary}
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <ScoreBlock
              title={t('detail.analysis.aePerformance')}
              overall={a.performance_score?.overall}
              dims={PERF.map((k) => [k, t(`detail.perf.${k}`)])}
              src={a.performance_score}
            />
            <ScoreBlock
              title={t('detail.analysis.clientAnalysis')}
              overall={a.client_analysis?.overall}
              dims={CLIENT.map((k) => [k, t(`detail.client.${k}`)])}
              src={a.client_analysis}
            />
          </div>

          {a.strengths?.length ? (
            <div>
              <SectionLabel>{t('detail.analysis.whatWorked')}</SectionLabel>
              {a.strengths.map((s, i) => (
                <Finding
                  key={i}
                  title={s.moment ?? t('detail.analysis.untitled')}
                  timestamp={s.timestamp}
                  pattern={s.methodology?.pattern}
                  edge="good"
                  rows={[[t('detail.analysis.whyItWorked'), s.why_effective]]}
                  quote={s.moment}
                />
              ))}
            </div>
          ) : null}

          {a.weaknesses?.length ? (
            <div>
              <SectionLabel>{t('detail.analysis.whatToImprove')}</SectionLabel>
              {a.weaknesses.map((w, i) => (
                <Finding
                  key={i}
                  title={w.area ?? t('detail.analysis.untitled')}
                  timestamp={w.timestamp}
                  pattern={w.methodology?.pattern}
                  edge="improve"
                  rows={[
                    [t('detail.analysis.observed'), w.observation],
                    [t('detail.analysis.try'), w.suggestion],
                  ]}
                  quote={w.evidence_quote}
                />
              ))}
            </div>
          ) : null}

          {/* Drive-synced rows carry the sheet's flattened text, not structured
              arrays — render it as-is so nothing is lost. */}
          {!a.strengths?.length && a.strengths_text ? (
            <div>
              <SectionLabel>{t('detail.analysis.whatWorked')}</SectionLabel>
              <pre className="whitespace-pre-wrap border-l-2 border-emerald-500 pl-3 font-sans text-sm text-foreground/90">
                {a.strengths_text}
              </pre>
            </div>
          ) : null}
          {!a.weaknesses?.length && a.weaknesses_text ? (
            <div>
              <SectionLabel>{t('detail.analysis.whatToImprove')}</SectionLabel>
              <pre className="whitespace-pre-wrap border-l-2 border-amber-500 pl-3 font-sans text-sm text-foreground/90">
                {a.weaknesses_text}
              </pre>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Signal({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {k}
      </div>
      <div className="truncate text-sm font-medium">{v}</div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function ScoreBlock({
  title,
  overall,
  dims,
  src,
}: {
  title: string;
  overall?: { score?: number | null };
  dims: [string, string][];
  src?: Record<string, { score?: number | null; rationale?: string | null }>;
}) {
  const t = useTranslations('sales');
  const ov = typeof overall?.score === 'number' ? overall.score : null;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm font-semibold">{title}</span>
        {ov !== null ? (
          <span className={cn('text-xl font-bold', scoreClass(ov))}>
            {ov}
            <span className="text-xs text-muted-foreground">
              {t('detail.analysis.scoreOutOf')}
            </span>
          </span>
        ) : null}
      </div>
      {dims.map(([key, label]) => {
        const s = src?.[key]?.score;
        if (typeof s !== 'number') return null;
        return (
          <div key={key} className="mb-2.5">
            <div className="mb-1 flex justify-between text-xs">
              <span>{label}</span>
              <span className={cn('font-semibold', scoreClass(s))}>{s}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', barClass(s))}
                style={{ width: `${s}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Finding({
  title,
  timestamp,
  pattern,
  edge,
  rows,
  quote,
}: {
  title: string;
  timestamp?: string;
  pattern?: string;
  edge: 'good' | 'improve';
  rows: [string, string | undefined][];
  quote?: string;
}) {
  return (
    <details
      className={cn(
        'group mb-2 overflow-hidden rounded-lg border bg-muted/20 [&_summary::-webkit-details-marker]:hidden',
        edge === 'good'
          ? 'border-l-2 border-l-emerald-500'
          : 'border-l-2 border-l-amber-500',
      )}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="truncate">{title}</span>
        {timestamp ? (
          <span className="text-xs text-muted-foreground">{timestamp}</span>
        ) : null}
        {pattern ? (
          <span className="ml-auto shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
            {pattern}
          </span>
        ) : null}
      </summary>
      <div className="border-t px-3 py-3 pl-9">
        {quote ? (
          <p className="mb-1.5 border-l-2 pl-2.5 text-xs italic text-foreground/80">
            “{quote}”
          </p>
        ) : null}
        {rows
          .filter(([, v]) => v)
          .map(([label, v]) => (
            <p key={label} className="text-xs">
              <span className="text-muted-foreground">{label}:</span> {v}
            </p>
          ))}
      </div>
    </details>
  );
}

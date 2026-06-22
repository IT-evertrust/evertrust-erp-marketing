'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { ConnectedGoogleAccountDto } from '@evertrust/shared';
import { AI_ENGINE_MODELS, ROLE_LABELS } from '@evertrust/shared';
import {
  useAiEngineConfig,
  useDisconnectGoogleAccount,
  useGoogleAccounts,
  useLeadScraperConfig,
  useSetDefaultMailbox,
  useUpdateAiEngineConfig,
  useUpdateLeadScraperConfig,
  useUpdateWorkflowConfig,
  useWorkflowConfig,
} from '@/hooks/use-arsenal';
import { ApiError, api } from '@/lib/api';
import { Can } from '@/components/auth/can';
import { GrowthCard } from '@/modules/(growth)/shared';
import { ToneBadge } from '@/components/rean/tone-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Whether a Google account's granted scopes include calendar access. Gmail is always
// implied (every connect grants the send/read mail scope); calendar is the variable
// one, so it's the only flag the table needs.
function hasCalendarScope(scopes: string[]): boolean {
  return scopes.some(
    (s) => s.includes('calendar.events') || s.includes('calendar.readonly'),
  );
}

// Shared eyebrow label — uppercase, tracked, muted. Matches the GrowthShell idiom.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </span>
  );
}

// A small "not live yet" affordance for the mockup cards below. Rendered as the
// card's head hint, it marks the section as a non-wired preview (no API, no hooks)
// using theme tokens only so it stays dark-mode safe.
function MockupBadge({ children }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-sidebar-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
      <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
      {children ?? 'Coming soon'}
    </span>
  );
}

// A disabled, presentational toggle for the mockup cards (no Switch component
// exists in the kit). `on` only sets the static visual state; it never changes.
// Always disabled — these are previews, not live controls.
function MockToggle({
  on = false,
  label,
}: {
  on?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled
      className="inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full border border-sidebar-border bg-muted/60 p-0.5 opacity-60 transition-colors data-[on=true]:bg-foreground/80"
      data-on={on}
    >
      <span
        className={[
          'size-3.5 rounded-full bg-background shadow-sm transition-transform',
          on ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  );
}

// A settings card rendered in the GrowthShell idiom: GrowthCard gives the
// rounded-[10px] bordered surface + title/hint head; the optional action (e.g. a
// Connect button) sits in the head's hint slot, the description leads the body.
function SettingsCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <GrowthCard title={title} hint={action} className={className}>
      <div className="flex flex-col gap-6">
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
    </GrowthCard>
  );
}

// ============================================================================
// Card 1 — Google Workspace
// ============================================================================
// Per-org Gmail/Calendar OAuth. The Connect button is open to any authenticated
// user (it just kicks off the consent redirect); the mailbox table, default control
// and disconnect are admin-only (server enforces admin:config) and gated with <Can>.
// On return from the consent screen the callback redirects to
// /settings/configuration?google=connected|error — we toast and strip the param on
// mount.
function GoogleWorkspaceCard() {
  const t = useTranslations('settings');
  const router = useRouter();
  const accounts = useGoogleAccounts();
  const setDefaultMailbox = useSetDefaultMailbox();
  const disconnect = useDisconnectGoogleAccount();

  // Whether the API is configured for Google connect. true until a 503 from start.
  const [connectConfigured, setConnectConfigured] = useState(true);
  const [connecting, setConnecting] = useState(false);
  // Which account id is mid-mutation, so we disable just that row's controls.
  const [pendingId, setPendingId] = useState<string | null>(null);

  const list = accounts.data ?? [];
  const busy = setDefaultMailbox.isPending || disconnect.isPending;

  // On return from Google's consent screen the callback appends ?google=connected|error.
  // Read it client-side (avoids the useSearchParams Suspense requirement), toast once,
  // refetch, then strip the param so a refresh doesn't re-toast. Runs once on mount.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('google');
    if (param !== 'connected' && param !== 'error') return;
    if (param === 'connected') {
      toast.success(t('config.google.toastConnected'));
      void accounts.refetch();
    } else {
      toast.error(t('config.google.toastConnectError'));
    }
    router.replace('/settings/configuration');
    // Mount-only: the param is consumed and stripped here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kick off the OAuth flow: ask the API for the consent URL, then leave the app with
  // a full-page redirect (NOT router.push — we hand off to Google). A 503 means the
  // API isn't configured for connect; show the disabled hint instead of crashing.
  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await api.google.start();
      window.location.href = res.url;
    } catch (err) {
      setConnecting(false);
      if (err instanceof ApiError && err.status === 503) {
        setConnectConfigured(false);
        return;
      }
      toast.error(
        err instanceof Error ? err.message : t('config.google.toastConnectError'),
      );
    }
  }

  // Promote a mailbox to the org's single default. The server returns the resolved
  // list (the single isDefault flag reflected); the hook seeds the cache.
  function handleSetDefault(a: ConnectedGoogleAccountDto) {
    if (a.isDefault) return;
    setPendingId(a.id);
    setDefaultMailbox.mutate(
      { accountId: a.id },
      {
        onSuccess: () => toast.success(t('config.google.toastDefaultSet')),
        onError: (err) => toast.error(err.message || t('config.google.toastError')),
        onSettled: () => setPendingId(null),
      },
    );
  }

  function handleDisconnect(a: ConnectedGoogleAccountDto) {
    if (!window.confirm(t('config.google.disconnectConfirm'))) return;
    setPendingId(a.id);
    disconnect.mutate(a.id, {
      onSuccess: () => toast.success(t('config.google.toastDisconnected')),
      onError: (err) => toast.error(err.message || t('config.google.toastError')),
      onSettled: () => setPendingId(null),
    });
  }

  const statusLabel: Record<ConnectedGoogleAccountDto['status'], string> = {
    CONNECTED: t('config.google.statusConnected'),
    REVOKED: t('config.google.statusRevoked'),
    ERROR: t('config.google.statusError'),
  };

  // Connect — open to any authenticated user. Disabled with a hint when the API
  // reports it isn't configured for Google connect (503 from start).
  const connectButton = (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleConnect}
        disabled={connecting || !connectConfigured}
      >
        {connecting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Plus className="size-4" />
        )}
        {connecting
          ? t('config.google.connecting')
          : t('config.google.connect')}
      </Button>
      {!connectConfigured ? (
        <p className="text-right text-xs text-muted-foreground">
          {t('config.google.notConfigured')}
        </p>
      ) : null}
    </div>
  );

  return (
    <SettingsCard
      title={t('config.google.title')}
      description={t('config.google.description')}
      action={connectButton}
    >
      {/* The mailbox table + default + disconnect are admin-only. */}
      <Can permission="admin:config">
        {accounts.isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : list.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {t('config.google.empty')}
            </p>
            {connectButton}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-sidebar-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('config.google.columnMailbox')}</TableHead>
                  <TableHead>{t('config.google.columnScopes')}</TableHead>
                  <TableHead className="text-right">
                    {t('config.google.columnDefault')}
                  </TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((a) => {
                  const rowBusy = busy && pendingId === a.id;
                  const calendar = hasCalendarScope(a.scopes);
                  return (
                    <TableRow key={a.id}>
                      {/* Mailbox: email (bold) + a small role/status hint. */}
                      <TableCell>
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{a.email}</span>
                            <ToneBadge tone="muted">
                              {ROLE_LABELS[a.role]}
                            </ToneBadge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {statusLabel[a.status]}
                          </span>
                        </div>
                      </TableCell>
                      {/* Scopes: Gmail (sky) always; Calendar (violet) when granted,
                          else a muted "no calendar" badge. */}
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          <ToneBadge tone="sky">
                            {t('config.google.scopeGmailBadge')}
                          </ToneBadge>
                          {calendar ? (
                            <ToneBadge tone="violet">
                              {t('config.google.scopeCalendarBadge')}
                            </ToneBadge>
                          ) : (
                            <ToneBadge tone="muted">
                              {t('config.google.scopeNoCalendar')}
                            </ToneBadge>
                          )}
                        </div>
                      </TableCell>
                      {/* Default: emerald "Default" badge when set, else a "Set
                          default" button promoting this mailbox to the org default. */}
                      <TableCell className="text-right">
                        {a.isDefault ? (
                          <ToneBadge tone="emerald">
                            {t('config.google.defaultBadge')}
                          </ToneBadge>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                            onClick={() => handleSetDefault(a)}
                            disabled={busy}
                          >
                            {t('config.google.setDefault')}
                          </Button>
                        )}
                      </TableCell>
                      {/* Subtle per-row disconnect (the mockup omits it, but it's
                          needed) — a small ghost control with a confirm. */}
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={t('config.google.disconnectAria', {
                            account: a.email,
                          })}
                          onClick={() => handleDisconnect(a)}
                          disabled={busy}
                        >
                          {rowBusy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Can>
    </SettingsCard>
  );
}

// ============================================================================
// Card 2 — Other integrations
// ============================================================================
// Two rows: Transactional email (connected when at least one Google account is
// connected) and DocuSign (a placeholder "Connect" — no backend yet).
function OtherIntegrationsCard() {
  const t = useTranslations('settings');
  const accounts = useGoogleAccounts();
  const emailConnected = (accounts.data ?? []).length > 0;

  return (
    <SettingsCard title={t('config.other.title')}>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="font-semibold">
                {t('config.other.emailLabel')}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {t('config.other.emailSublabel')}
              </TableCell>
              <TableCell className="text-right">
                {emailConnected ? (
                  <ToneBadge tone="emerald">
                    {t('config.other.connected')}
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="muted">
                    {t('config.other.notConnected')}
                  </ToneBadge>
                )}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-semibold">
                {t('config.other.docusignLabel')}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {t('config.other.docusignSublabel')}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => toast(t('config.other.comingSoon'))}
                >
                  {t('config.other.connect')}
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </SettingsCard>
  );
}

// ============================================================================
// Card 3 — AI engine
// ============================================================================
// A narrower card: a Model select (from AI_ENGINE_MODELS), a Gateway text input,
// and a Save button (PUT ai-engine). Initial values load from GET ai-engine.
const MODEL_UNSET = '__unset__';

function AiEngineCard() {
  const t = useTranslations('settings');
  const config = useAiEngineConfig();
  const update = useUpdateAiEngineConfig();
  const data = config.data;

  // Local form state, seeded from the GET. '' gateway clears the override.
  const [model, setModel] = useState<string>(MODEL_UNSET);
  const [gateway, setGateway] = useState<string>('');
  // Agent gateway (drives the Python agents' local LLM, per org). Blank → env default.
  const [agentGateway, setAgentGateway] = useState<string>('');
  const [agentModel, setAgentModel] = useState<string>('');

  // The select options: always the product list, plus the current value if it has
  // drifted off the list (so a legacy model still renders).
  const modelOptions = useMemo(() => {
    const opts = [...AI_ENGINE_MODELS];
    if (data?.model && !opts.includes(data.model)) opts.push(data.model);
    return opts;
  }, [data?.model]);

  useEffect(() => {
    if (!data) return;
    setModel(data.model ?? MODEL_UNSET);
    setGateway(data.gateway ?? '');
    setAgentGateway(data.agentGateway ?? '');
    setAgentModel(data.agentModel ?? '');
  }, [data]);

  function handleSave() {
    update.mutate(
      {
        model: model === MODEL_UNSET ? null : model,
        gateway: gateway.trim() === '' ? null : gateway.trim(),
        agentGateway: agentGateway.trim() === '' ? null : agentGateway.trim(),
        agentModel: agentModel.trim() === '' ? null : agentModel.trim(),
      },
      {
        onSuccess: () => toast.success(t('config.ai.toastSaved')),
        onError: (err) => toast.error(err.message || t('config.ai.toastError')),
      },
    );
  }

  return (
    <SettingsCard title={t('config.ai.title')} className="max-w-[620px]">
      {config.isLoading || !data ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-model">
                <Eyebrow>{t('config.ai.modelLabel')}</Eyebrow>
              </Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="ai-model">
                  <SelectValue placeholder={t('config.ai.modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODEL_UNSET}>
                    {t('config.ai.modelDefault')}
                  </SelectItem>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ai-gateway">
                <Eyebrow>{t('config.ai.gatewayLabel')}</Eyebrow>
              </Label>
              <Input
                id="ai-gateway"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('config.ai.gatewayPlaceholder')}
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
              />
            </div>
          </div>

          {/* Agent gateway — drives the Python agents' local LLM, resolved per org
              (org value ?? env default). Separate from the Claude model above, which
              powers the ERP's own AI features. The API key is never edited here; it
              stays in the agents' env. */}
          <div className="border-t border-sidebar-border pt-4">
            <Eyebrow>{t('config.ai.agentSectionTitle')}</Eyebrow>
            <p className="mb-3 mt-1.5 text-xs text-muted-foreground">
              {t('config.ai.agentSectionHint')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-gateway">
                  <Eyebrow>{t('config.ai.agentGatewayLabel')}</Eyebrow>
                </Label>
                <Input
                  id="agent-gateway"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('config.ai.agentGatewayPlaceholder')}
                  value={agentGateway}
                  onChange={(e) => setAgentGateway(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agent-model">
                  <Eyebrow>{t('config.ai.agentModelLabel')}</Eyebrow>
                </Label>
                <Input
                  id="agent-model"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t('config.ai.agentModelPlaceholder')}
                  value={agentModel}
                  onChange={(e) => setAgentModel(e.target.value)}
                />
              </div>
            </div>
          </div>
          <Button
            type="button"
            className="self-start"
            onClick={handleSave}
            disabled={update.isPending}
          >
            {update.isPending ? t('config.ai.saving') : t('config.ai.save')}
          </Button>
        </>
      )}
    </SettingsCard>
  );
}

// ============================================================================
// Card — Lead scraper tuning
// ============================================================================
// Three numeric overrides for the lead-hunting agent (leadTarget, maxQueries,
// minScore), resolved per org (org value ?? agent env default). A blank input
// clears the override → null → the server default. Writes ride the dedicated
// /arsenal/config/lead-scraper PUT (admin:config).
function LeadScraperCard() {
  const t = useTranslations('settings');
  const config = useLeadScraperConfig();
  const update = useUpdateLeadScraperConfig();
  const data = config.data;

  // Local form state, seeded from the GET. '' clears the override (→ env default).
  const [leadTarget, setLeadTarget] = useState<string>('');
  const [maxQueries, setMaxQueries] = useState<string>('');
  const [minScore, setMinScore] = useState<string>('');

  useEffect(() => {
    if (!data) return;
    setLeadTarget(data.leadTarget == null ? '' : String(data.leadTarget));
    setMaxQueries(data.maxQueries == null ? '' : String(data.maxQueries));
    setMinScore(data.minScore == null ? '' : String(data.minScore));
  }, [data]);

  // '' (or unparseable) → null clears the override; otherwise the integer value.
  function toNullableInt(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? null : n;
  }

  function handleSave() {
    update.mutate(
      {
        leadTarget: toNullableInt(leadTarget),
        maxQueries: toNullableInt(maxQueries),
        minScore: toNullableInt(minScore),
      },
      {
        onSuccess: () => toast.success(t('config.leadScraper.toastSaved')),
        onError: (err) =>
          toast.error(err.message || t('config.leadScraper.toastError')),
      },
    );
  }

  return (
    <SettingsCard title={t('config.leadScraper.title')} className="max-w-[620px]">
      {config.isLoading || !data ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lead-target">
                <Eyebrow>{t('config.leadScraper.leadTargetLabel')}</Eyebrow>
              </Label>
              <Input
                id="lead-target"
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={leadTarget}
                onChange={(e) => setLeadTarget(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('config.leadScraper.leadTargetHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="max-queries">
                <Eyebrow>{t('config.leadScraper.maxQueriesLabel')}</Eyebrow>
              </Label>
              <Input
                id="max-queries"
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={maxQueries}
                onChange={(e) => setMaxQueries(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('config.leadScraper.maxQueriesHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="min-score">
                <Eyebrow>{t('config.leadScraper.minScoreLabel')}</Eyebrow>
              </Label>
              <Input
                id="min-score"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('config.leadScraper.minScoreHint')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="self-start"
            onClick={handleSave}
            disabled={update.isPending}
          >
            {update.isPending
              ? t('config.leadScraper.saving')
              : t('config.leadScraper.save')}
          </Button>
        </>
      )}
    </SettingsCard>
  );
}

// ============================================================================
// Card — Sales calendar timezone
// ============================================================================
// Per-org timezones for the Activate calendar (org_config.salesTimeZone /
// salesSecondaryTimeZone). Both are raw overrides: a blank primary inherits the
// product default (Europe/Berlin); a blank secondary drops the dual time scale.
// Writes ride the WorkflowConfig PUT (admin:config); the backend validates the IANA
// zone, so an invalid value surfaces as the API error toast.
function SalesCalendarCard() {
  const t = useTranslations('settings');
  const config = useWorkflowConfig();
  const update = useUpdateWorkflowConfig();
  const data = config.data;

  const [primary, setPrimary] = useState<string>('');
  const [secondary, setSecondary] = useState<string>('');

  useEffect(() => {
    if (!data) return;
    setPrimary(data.salesTimeZone ?? '');
    setSecondary(data.salesSecondaryTimeZone ?? '');
  }, [data]);

  function handleSave() {
    update.mutate(
      {
        // '' clears the override (primary → product default, secondary → no gutter).
        salesTimeZone: primary.trim() === '' ? null : primary.trim(),
        salesSecondaryTimeZone: secondary.trim() === '' ? null : secondary.trim(),
      },
      {
        onSuccess: () => toast.success(t('config.calendar.toastSaved')),
        onError: (err) => toast.error(err.message || t('config.calendar.toastError')),
      },
    );
  }

  return (
    <SettingsCard
      title={t('config.calendar.title')}
      description={t('config.calendar.description')}
      className="max-w-[620px]"
    >
      {config.isLoading || !data ? (
        <Skeleton className="h-32 w-full rounded-lg" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sales-tz-primary">
                <Eyebrow>{t('config.calendar.primaryLabel')}</Eyebrow>
              </Label>
              <Input
                id="sales-tz-primary"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('config.calendar.primaryPlaceholder')}
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sales-tz-secondary">
                <Eyebrow>{t('config.calendar.secondaryLabel')}</Eyebrow>
              </Label>
              <Input
                id="sales-tz-secondary"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('config.calendar.secondaryPlaceholder')}
                value={secondary}
                onChange={(e) => setSecondary(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('config.calendar.hint')}</p>
          <Button
            type="button"
            className="self-start"
            onClick={handleSave}
            disabled={update.isPending}
          >
            {update.isPending ? t('config.calendar.saving') : t('config.calendar.save')}
          </Button>
        </>
      )}
    </SettingsCard>
  );
}

// ============================================================================
// MOCKUP CARDS (not wired to any backend yet)
// ----------------------------------------------------------------------------
// The four cards below are visual mockups in the same SettingsCard idiom as the
// live cards above. They call NO API, use NO hooks/mutations, and every control
// is disabled. Each carries a MockupBadge so it reads as a preview. Strings are
// plain English (this file's `settings` namespace has no keys for them yet) and
// should be swept into i18n when these wire to the backend.
// ============================================================================

// Mockup A — Reach send mode. Reflects the global REACH_SEND_MODE today; per-org
// wiring (a test/live toggle, a test recipient, a daily cap) is pending. All
// controls disabled.
function ReachSendModeCard() {
  return (
    <SettingsCard
      title="Reach send mode"
      description="Controls whether the Reach sender delivers real email or routes everything to a test inbox. Today this reflects the global REACH_SEND_MODE; per-org wiring is pending."
      action={<MockupBadge>Mockup — wires to backend next</MockupBadge>}
      className="max-w-[620px]"
    >
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Send mode</Eyebrow>
        {/* Segmented test/live toggle, defaulting to Test. Disabled mockup. */}
        <div
          role="group"
          aria-label="Send mode"
          className="inline-flex w-fit rounded-[10px] border border-sidebar-border bg-muted/40 p-0.5 opacity-70"
        >
          <span className="rounded-[8px] bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm">
            Test
          </span>
          <span className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            Live
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Default is Test — outbound is captured, never delivered to prospects.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reach-test-recipient">
            <Eyebrow>Test recipient</Eyebrow>
          </Label>
          <Input
            id="reach-test-recipient"
            type="email"
            disabled
            autoComplete="off"
            placeholder="qa@your-org.com"
          />
          <p className="text-xs text-muted-foreground">
            Where test-mode sends are routed.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reach-daily-cap">
            <Eyebrow>Daily send cap</Eyebrow>
          </Label>
          <Input
            id="reach-daily-cap"
            type="number"
            min={0}
            inputMode="numeric"
            disabled
            autoComplete="off"
            placeholder="200"
          />
          <p className="text-xs text-muted-foreground">
            Max outbound emails per day across the org.
          </p>
        </div>
      </div>

      <Button type="button" className="self-start" disabled>
        Save send settings
      </Button>
    </SettingsCard>
  );
}

// Mockup B — Branding & sender identity. Org logo drop area, sender display name,
// email signature, and an accent-color swatch. All disabled.
function BrandingCard() {
  return (
    <SettingsCard
      title="Branding & sender identity"
      description="How your org presents itself in outbound email and across the app — logo, sender name, signature, and accent color."
      action={<MockupBadge>Coming soon</MockupBadge>}
      className="max-w-[620px]"
    >
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Org logo</Eyebrow>
        {/* Dashed drop area placeholder — disabled, non-interactive. */}
        <div
          aria-disabled
          className="flex flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-sidebar-border bg-muted/30 px-4 py-8 text-center opacity-70"
        >
          <Plus className="size-5 text-muted-foreground" aria-hidden />
          <span className="text-xs font-medium text-foreground">
            Drag a logo here, or browse
          </span>
          <span className="text-[11px] text-muted-foreground">
            PNG or SVG, up to 1 MB
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branding-sender-name">
            <Eyebrow>Sender display name</Eyebrow>
          </Label>
          <Input
            id="branding-sender-name"
            disabled
            autoComplete="off"
            placeholder="EverTrust Sales"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="branding-accent">
            <Eyebrow>Accent color</Eyebrow>
          </Label>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-9 shrink-0 rounded-md border border-sidebar-border bg-foreground/80"
            />
            <Input
              id="branding-accent"
              disabled
              autoComplete="off"
              spellCheck={false}
              placeholder="#3B5BDB"
              className="font-mono"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="branding-signature">
          <Eyebrow>Email signature</Eyebrow>
        </Label>
        <Textarea
          id="branding-signature"
          disabled
          rows={4}
          placeholder={'Best regards,\nThe EverTrust Team'}
        />
        <p className="text-xs text-muted-foreground">
          Appended to outbound email from this org.
        </p>
      </div>

      <Button type="button" className="self-start" disabled>
        Save branding
      </Button>
    </SettingsCard>
  );
}

// Mockup C — Notifications & alerts. A list of event rows, each with an in-app and
// an email toggle. All toggles disabled (static preview state).
function NotificationsCard() {
  const rows: {
    key: string;
    label: string;
    description: string;
    inApp: boolean;
    email: boolean;
  }[] = [
    {
      key: 'engine-failure',
      label: 'Engine-failure alerts',
      description: 'An agent run errors or stalls.',
      inApp: true,
      email: true,
    },
    {
      key: 'new-reply',
      label: 'New reply received',
      description: 'A prospect replies to an outbound thread.',
      inApp: true,
      email: false,
    },
    {
      key: 'meeting-booked',
      label: 'Meeting booked / reminders',
      description: 'A meeting is scheduled or coming up.',
      inApp: true,
      email: true,
    },
  ];

  return (
    <SettingsCard
      title="Notifications & alerts"
      description="Choose where each event shows up. In-app surfaces in the notification bell; email sends to your address."
      action={<MockupBadge>Coming soon</MockupBadge>}
      className="max-w-[620px]"
    >
      <div className="overflow-hidden rounded-[10px] border border-sidebar-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead className="w-20 text-center">In-app</TableHead>
              <TableHead className="w-20 text-center">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold">{r.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.description}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <MockToggle
                      on={r.inApp}
                      label={`${r.label} — in-app`}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center">
                    <MockToggle on={r.email} label={`${r.label} — email`} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SettingsCard>
  );
}

// Mockup D — Integrations marketplace. A small grid of connect tiles for the
// not-yet-built integrations, placed as a sibling of the live Google Workspace
// card (which stays the one real, working integration). Disabled Connect buttons.
function IntegrationsMarketplaceCard() {
  const tiles: { key: string; name: string; blurb: string }[] = [
    { key: 'hubspot', name: 'HubSpot', blurb: 'Sync contacts & deals' },
    { key: 'docusign', name: 'DocuSign', blurb: 'E-signature for contracts' },
    { key: 'whatsapp', name: 'WhatsApp', blurb: 'Outbound messaging' },
  ];

  return (
    <SettingsCard
      title="Integrations marketplace"
      description="Connect more tools to your org. Google Workspace is live above; these are on the way."
      action={<MockupBadge>Coming soon</MockupBadge>}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <div
            key={tile.key}
            className="flex flex-col gap-3 rounded-[10px] border border-sidebar-border bg-card p-4"
          >
            <div className="flex items-center gap-3">
              {/* Logo placeholder — the integration's initial in a token tile. */}
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-muted/50 text-sm font-bold text-muted-foreground"
              >
                {tile.name.charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">
                  {tile.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {tile.blurb}
                </div>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled
            >
              <Plus className="size-4" />
              Connect
            </Button>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

// Configuration: integrations + AI engine + sales-calendar timezone, admin-only (the
// route gates on admin:config).
export function ConfigurationSettings() {
  // The GrowthTopbar renders the single "Configuration" masthead (title +
  // subtitle), so this page renders NO header of its own — only the cards.
  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="flex flex-col gap-4">
        {/* Live, working integration first, with the (mockup) marketplace as a
            sibling right beside it. */}
        <GoogleWorkspaceCard />
        <IntegrationsMarketplaceCard />
        <OtherIntegrationsCard />
        <AiEngineCard />
        <LeadScraperCard />
        <SalesCalendarCard />
        {/* Mockup sections — not wired to any backend yet. */}
        <ReachSendModeCard />
        <BrandingCard />
        <NotificationsCard />
      </div>
    </main>
  );
}

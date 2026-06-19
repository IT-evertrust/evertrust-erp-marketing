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
  useSetDefaultMailbox,
  useUpdateAiEngineConfig,
  useUpdateWorkflowConfig,
  useWorkflowConfig,
} from '@/hooks/use-arsenal';
import { ApiError, api } from '@/lib/api';
import { Can } from '@/components/auth/can';
import { PageHeader } from '@/components/common/page-header';
import { ToneBadge } from '@/components/rean/tone-badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

// A card matching the mockup's "card-head" layout: title left, an optional action
// (e.g. a Connect button) flush right, then the body.
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
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">{children}</CardContent>
    </Card>
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
          <div className="overflow-x-auto rounded-lg border">
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
  }, [data]);

  function handleSave() {
    update.mutate(
      {
        model: model === MODEL_UNSET ? null : model,
        gateway: gateway.trim() === '' ? null : gateway.trim(),
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
              <Label htmlFor="ai-model">{t('config.ai.modelLabel')}</Label>
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
              <Label htmlFor="ai-gateway">{t('config.ai.gatewayLabel')}</Label>
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
              <Label htmlFor="sales-tz-primary">{t('config.calendar.primaryLabel')}</Label>
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
              <Label htmlFor="sales-tz-secondary">{t('config.calendar.secondaryLabel')}</Label>
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

// Configuration: integrations + AI engine + sales-calendar timezone, admin-only (the
// route gates on admin:config).
export function ConfigurationSettings() {
  const t = useTranslations('settings');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('config.header.title')}
        description={t('config.header.description')}
      />
      <GoogleWorkspaceCard />
      <OtherIntegrationsCard />
      <AiEngineCard />
      <SalesCalendarCard />
    </div>
  );
}

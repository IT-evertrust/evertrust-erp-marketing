'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Copy, ShieldOff, Target, Users } from 'lucide-react';
import type {
  TestN8nResultDto,
  UpdateWorkflowConfigDto,
  WorkflowConfigDto,
} from '@evertrust/shared';
import {
  useClearIngestToken,
  useRotateIngestToken,
  useTestN8n,
  useUpdateWorkflowConfig,
  useWorkflowConfig,
} from '@/hooks/use-arsenal';
import { timeAgo } from '@/lib/arsenal-sequence';
import { Can } from '@/components/auth/can';
import { PageHeader } from '@/components/common/page-header';
import { BazookaSchedule } from '@/components/growth/bazooka-schedule';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';

// The six Growth-Engine webhook stages, in pipeline order, with their friendly
// labels. The key matches WorkflowConfigDto.webhooks; the label is what operators
// see (the codenames map to AIM → Lead Satellite → … → Sleeper Grenade).
const WEBHOOK_STAGES = [
  { key: 'aim', label: 'AIM · Launch' },
  { key: 'leadSatellite', label: 'Lead Satellite' },
  { key: 'ammoForge', label: 'Ammo Forge' },
  { key: 'reachBazooka', label: 'Reach Bazooka' },
  { key: 'replyGlock', label: 'Reply Glock' },
  { key: 'sleeperGrenade', label: 'Sleeper Grenade' },
] as const satisfies ReadonlyArray<{
  key: keyof WorkflowConfigDto['webhooks'];
  label: string;
}>;

type WebhookKey = (typeof WEBHOOK_STAGES)[number]['key'];

// The editable subset of the config, flattened into a form. Every value is a
// string so an empty field reads as "clear the override → fall back to env":
// webhooks/url empty → null, offsets empty → null, sender '' → "use default".
type FormState = {
  webhooks: Record<WebhookKey, string>;
  n8nApiUrl: string;
  defaultSender: '' | 'info' | 'hanna';
  followupOffsetDays: string;
  finalPushOffsetDays: string;
};

// Project the GET response onto the form. The {value, overridden} envelope only
// contributes `value` here (the badge reads `overridden` straight from the data);
// a null value seeds an empty field.
function toForm(c: WorkflowConfigDto): FormState {
  return {
    webhooks: {
      aim: c.webhooks.aim.value ?? '',
      leadSatellite: c.webhooks.leadSatellite.value ?? '',
      ammoForge: c.webhooks.ammoForge.value ?? '',
      reachBazooka: c.webhooks.reachBazooka.value ?? '',
      replyGlock: c.webhooks.replyGlock.value ?? '',
      sleeperGrenade: c.webhooks.sleeperGrenade.value ?? '',
    },
    n8nApiUrl: c.n8nApiUrl.value ?? '',
    defaultSender: c.defaultSender ?? '',
    followupOffsetDays:
      c.followupOffsetDays == null ? '' : String(c.followupOffsetDays),
    finalPushOffsetDays:
      c.finalPushOffsetDays == null ? '' : String(c.finalPushOffsetDays),
  };
}

// A small emerald/amber status dot + text, for the read-only secret-status rows.
function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        className={cn(
          'size-2 rounded-full',
          ok ? 'bg-emerald-500' : 'bg-amber-500',
        )}
      />
      {label}
    </span>
  );
}

// The inline result of a "Test connection" probe. Tri-state dot: emerald when the
// call succeeded, amber when n8n is configured but the probe failed, muted when
// it isn't wired up at all. Appends the workflow count when the probe read one.
function N8nTestResult({ result }: { result: TestN8nResultDto }) {
  const t = useTranslations('settings');
  const tone = result.ok
    ? 'bg-emerald-500'
    : result.configured
      ? 'bg-amber-500'
      : 'bg-muted-foreground';
  const text =
    result.workflowCount != null
      ? `${result.detail} · ${t('config.n8n.workflowCount', {
          count: result.workflowCount,
        })}`
      : result.detail;
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn('size-2 shrink-0 rounded-full', tone)} />
      {text}
    </p>
  );
}

// Custom (an override is set) vs Env default (falling back to the env var).
function OverrideBadge({ overridden }: { overridden: boolean }) {
  const t = useTranslations('settings');
  return overridden ? (
    <Badge
      variant="outline"
      className="border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
    >
      {t('config.badge.custom')}
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      {t('config.badge.envDefault')}
    </Badge>
  );
}

// A shortcut row into an existing config surface (niches, suppressions, users).
function CatalogLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

// Loose URL check (mirrors the server's NullableUrlOverride) so a bad URL fails
// with a friendly toast instead of a raw ZodError from the client-side parse.
function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Configuration: the editable Growth-Engine control panel, admin-only (the route
// gates on admin:config). Webhook URLs + the n8n base URL are editable overrides;
// secrets (n8n API key, ingest token) are status-only, never inputs.
export function ConfigurationSettings() {
  const t = useTranslations('settings');
  const config = useWorkflowConfig();
  const update = useUpdateWorkflowConfig();
  const testN8n = useTestN8n();
  const rotate = useRotateIngestToken();
  const clearToken = useClearIngestToken();
  const data = config.data;

  // Localized labels for the ingest-token source (resolved here; can't call
  // hooks at module scope).
  const ingestSourceLabel: Record<WorkflowConfigDto['ingestTokenSource'], string> =
    {
      rotated: t('config.ingest.sourceRotated'),
      env: t('config.ingest.sourceEnv'),
      none: t('config.ingest.sourceNone'),
    };

  // The latest n8n probe result, rendered inline beneath the API URL field.
  const [n8nResult, setN8nResult] = useState<TestN8nResultDto | null>(null);
  // The freshly-rotated ingest token — held only to reveal it once in the dialog.
  // Setting it opens the dialog; clearing it (Done / dismiss) drops the plaintext.
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);

  // The form is seeded from the GET; `baseline` is the same projection, used to
  // diff for dirty-tracking and to send only the fields the operator changed.
  const baseline = useMemo(() => (data ? toForm(data) : null), [data]);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (baseline) setForm(baseline);
  }, [baseline]);

  const dirty =
    !!form && !!baseline && JSON.stringify(form) !== JSON.stringify(baseline);

  function setWebhook(key: WebhookKey, value: string) {
    setForm((f) => (f ? { ...f, webhooks: { ...f.webhooks, [key]: value } } : f));
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  // Build the partial PUT body: only changed fields, with empty strings coerced to
  // null (clear the override → env). Offsets parse to int-or-null; sender '' → null.
  function buildPatch(f: FormState, base: FormState): UpdateWorkflowConfigDto {
    const patch: UpdateWorkflowConfigDto = {};

    const webhooks: NonNullable<UpdateWorkflowConfigDto['webhooks']> = {};
    for (const { key } of WEBHOOK_STAGES) {
      if (f.webhooks[key] !== base.webhooks[key]) {
        webhooks[key] = f.webhooks[key].trim() === '' ? null : f.webhooks[key].trim();
      }
    }
    if (Object.keys(webhooks).length > 0) patch.webhooks = webhooks;

    if (f.n8nApiUrl !== base.n8nApiUrl) {
      patch.n8nApiUrl = f.n8nApiUrl.trim() === '' ? null : f.n8nApiUrl.trim();
    }
    if (f.defaultSender !== base.defaultSender) {
      patch.defaultSender = f.defaultSender === '' ? null : f.defaultSender;
    }
    if (f.followupOffsetDays !== base.followupOffsetDays) {
      patch.followupOffsetDays =
        f.followupOffsetDays.trim() === ''
          ? null
          : Number(f.followupOffsetDays);
    }
    if (f.finalPushOffsetDays !== base.finalPushOffsetDays) {
      patch.finalPushOffsetDays =
        f.finalPushOffsetDays.trim() === ''
          ? null
          : Number(f.finalPushOffsetDays);
    }
    return patch;
  }

  function save() {
    if (!form || !baseline) return;
    const patch = buildPatch(form, baseline);

    // Client-side guards for friendly errors (the server/DTO enforce the same).
    for (const { key, label } of WEBHOOK_STAGES) {
      const v = patch.webhooks?.[key];
      if (typeof v === 'string' && !isValidUrl(v)) {
        toast.error(t('config.save.invalidWebhook', { label }));
        return;
      }
    }
    if (typeof patch.n8nApiUrl === 'string' && !isValidUrl(patch.n8nApiUrl)) {
      toast.error(t('config.save.invalidApiUrl'));
      return;
    }
    for (const days of [patch.followupOffsetDays, patch.finalPushOffsetDays]) {
      if (typeof days === 'number' && (!Number.isInteger(days) || days < 0)) {
        toast.error(t('config.save.invalidCadence'));
        return;
      }
    }

    update.mutate(patch, {
      onSuccess: () => toast.success(t('config.save.toastOk')),
      onError: (e) => toast.error(e.message || t('config.save.toastError')),
    });
  }

  // Probe the live n8n connection; show the result inline + a matching toast.
  function handleTestN8n() {
    testN8n.mutate(undefined, {
      onSuccess: (result) => {
        setN8nResult(result);
        if (result.ok) toast.success(t('config.n8n.toastOk'));
        else if (result.configured)
          toast.error(t('config.n8n.toastError', { detail: result.detail }));
        else toast.error(t('config.n8n.toastNotConfigured'));
      },
      onError: (e) => {
        setN8nResult(null);
        toast.error(e.message || t('config.n8n.toastUnreachable'));
      },
    });
  }

  // Mint a new ingest token. The plaintext is returned ONCE — reveal it in the
  // dialog; the config query is invalidated by the hook so the status refreshes.
  function handleRotateToken() {
    rotate.mutate(undefined, {
      onSuccess: (result) => setRotatedToken(result.token),
      onError: (e) => toast.error(e.message || t('config.ingest.rotateError')),
    });
  }

  // Copy the one-time token to the clipboard.
  async function copyToken() {
    if (!rotatedToken) return;
    try {
      await navigator.clipboard.writeText(rotatedToken);
      toast.success(t('config.ingest.copied'));
    } catch {
      toast.error(t('config.ingest.copyError'));
    }
  }

  // Revert machine-route auth to the env token. Behind a confirm since it changes
  // how n8n authenticates to the ERP.
  function handleRevertToken() {
    if (!window.confirm(t('config.ingest.revertConfirm'))) {
      return;
    }
    clearToken.mutate(undefined, {
      onSuccess: () => toast.success(t('config.ingest.revertToast')),
      onError: (e) => toast.error(e.message || t('config.ingest.revertError')),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('config.header.title')}
        description={t('config.header.description')}
      />

      {config.isLoading || !form || !data ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* 1. Workflow wiring — one editable row per webhook stage. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.wiring.title')}</CardTitle>
              <CardDescription>
                {t('config.wiring.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {WEBHOOK_STAGES.map(({ key, label }) => {
                const field = data.webhooks[key];
                const inputId = `webhook-${key}`;
                return (
                  <div key={key} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor={inputId}>{label}</Label>
                      <OverrideBadge overridden={field.overridden} />
                    </div>
                    <Input
                      id={inputId}
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-xs"
                      placeholder={
                        !field.overridden && field.value
                          ? field.value
                          : 'https://n8n.example.com/webhook/…'
                      }
                      value={form.webhooks[key]}
                      onChange={(e) => setWebhook(key, e.target.value)}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* 2. n8n connection — editable base URL + read-only API-key status. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.n8n.title')}</CardTitle>
              <CardDescription>
                {t('config.n8n.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="n8n-api-url">{t('config.n8n.apiUrlLabel')}</Label>
                  <OverrideBadge overridden={data.n8nApiUrl.overridden} />
                </div>
                <Input
                  id="n8n-api-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  placeholder={
                    !data.n8nApiUrl.overridden && data.n8nApiUrl.value
                      ? data.n8nApiUrl.value
                      : 'https://n8n.example.com/api/v1'
                  }
                  value={form.n8nApiUrl}
                  onChange={(e) => setField('n8nApiUrl', e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <span className="text-sm font-medium">
                  {t('config.n8n.apiKeyLabel')}
                </span>
                <StatusDot
                  ok={data.n8nApiKeySet}
                  label={
                    data.n8nApiKeySet
                      ? t('config.n8n.apiKeySet')
                      : t('config.n8n.apiKeyNotSet')
                  }
                />
              </div>
              <div className="flex flex-col gap-2 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={handleTestN8n}
                  disabled={testN8n.isPending}
                >
                  {testN8n.isPending
                    ? t('config.n8n.testing')
                    : t('config.n8n.testConnection')}
                </Button>
                {n8nResult ? <N8nTestResult result={n8nResult} /> : null}
              </div>
            </CardContent>
          </Card>

          {/* 3. Ingest security — read-only status + rotate / revert actions. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.ingest.title')}</CardTitle>
              <CardDescription>
                {t('config.ingest.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">
                  {t('config.ingest.tokenLabel')}
                </span>
                <StatusDot
                  ok={data.ingestTokenSet}
                  label={ingestSourceLabel[data.ingestTokenSource]}
                />
              </div>
              {data.ingestTokenSetAt ? (
                <p className="text-xs text-muted-foreground">
                  {t('config.ingest.lastSet', {
                    ago: timeAgo(data.ingestTokenSetAt),
                  })}
                </p>
              ) : null}
              <div className="mt-1 flex flex-wrap items-center gap-3 border-t pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRotateToken}
                  disabled={rotate.isPending}
                >
                  {rotate.isPending
                    ? t('config.ingest.rotating')
                    : t('config.ingest.rotate')}
                </Button>
                {data.ingestTokenSource === 'rotated' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={handleRevertToken}
                    disabled={clearToken.isPending}
                  >
                    {clearToken.isPending
                      ? t('config.ingest.reverting')
                      : t('config.ingest.revert')}
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* 4. Cadence & sender — default Gmail alias + follow-up offsets. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.cadence.title')}</CardTitle>
              <CardDescription>
                {t('config.cadence.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="default-sender">
                  {t('config.cadence.senderLabel')}
                </Label>
                <Select
                  value={form.defaultSender === '' ? 'default' : form.defaultSender}
                  onValueChange={(v) =>
                    setField(
                      'defaultSender',
                      v === 'default' ? '' : (v as 'info' | 'hanna'),
                    )
                  }
                >
                  <SelectTrigger id="default-sender" className="max-w-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">
                      {t('config.cadence.senderDefault')}
                    </SelectItem>
                    <SelectItem value="info">
                      {t('config.cadence.senderInfo')}
                    </SelectItem>
                    <SelectItem value="hanna">
                      {t('config.cadence.senderHanna')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="followup-offset">
                    {t('config.cadence.followupLabel')}
                  </Label>
                  <Input
                    id="followup-offset"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="max-w-[10rem] tabular-nums"
                    placeholder="2"
                    value={form.followupOffsetDays}
                    onChange={(e) =>
                      setField('followupOffsetDays', e.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="finalpush-offset">
                    {t('config.cadence.finalPushLabel')}
                  </Label>
                  <Input
                    id="finalpush-offset"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="max-w-[10rem] tabular-nums"
                    placeholder="4"
                    value={form.finalPushOffsetDays}
                    onChange={(e) =>
                      setField('finalPushOffsetDays', e.target.value)
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Daily send — the existing ERP-side daily Bazooka control. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.dailySend.title')}</CardTitle>
              <CardDescription>
                {t('config.dailySend.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <BazookaSchedule />
            </CardContent>
          </Card>

          {/* 5. Managed catalogs — shortcuts into the existing config surfaces. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.catalogs.title')}</CardTitle>
              <CardDescription>
                {t('config.catalogs.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <CatalogLink
                href="/marketing/niches"
                icon={Target}
                title={t('config.catalogs.nichesTitle')}
                description={t('config.catalogs.nichesDescription')}
              />
              <CatalogLink
                href="/marketing/suppressions"
                icon={ShieldOff}
                title={t('config.catalogs.suppressionsTitle')}
                description={t('config.catalogs.suppressionsDescription')}
              />
              <Can permission="users:manage">
                <CatalogLink
                  href="/users"
                  icon={Users}
                  title={t('config.catalogs.usersTitle')}
                  description={t('config.catalogs.usersDescription')}
                />
              </Can>
            </CardContent>
          </Card>

          {/* Sticky save bar — only the changed editable fields are sent. */}
          <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {dirty ? (
              <span className="text-xs text-muted-foreground">
                {t('config.save.unsaved')}
              </span>
            ) : null}
            <Button
              type="button"
              onClick={save}
              disabled={!dirty || update.isPending}
            >
              {update.isPending
                ? t('config.save.saving')
                : t('config.save.saveChanges')}
            </Button>
          </div>
        </>
      )}

      {/* One-time reveal of a freshly-rotated ingest token. Closing drops the
          plaintext from state; the status already refreshed via the config query. */}
      <Dialog
        open={rotatedToken !== null}
        onOpenChange={(open) => {
          if (!open) setRotatedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('config.ingest.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('config.ingest.dialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all select-all">
              {rotatedToken}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyToken}
              aria-label={t('config.ingest.copyAria')}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setRotatedToken(null)}>
              {t('config.ingest.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

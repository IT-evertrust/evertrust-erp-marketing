'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  Copy,
  ImageOff,
  ShieldOff,
  Target,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type {
  DefaultTemplateDto,
  OutreachTone,
  TemplateLanguage,
  TestN8nResultDto,
  UpdateWorkflowConfigDto,
  WorkflowConfigDto,
} from '@evertrust/shared';
import {
  useClearIngestToken,
  useClearSignatureImage,
  useLeadStats,
  useRotateIngestToken,
  useSetSignatureImageUrl,
  useTestN8n,
  useUpdateWorkflowConfig,
  useUploadSignatureImage,
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
import { Textarea } from '@/components/ui/textarea';
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

// The three blocks of the default outreach sequence, in send order. The key
// matches DefaultTemplateDto; the label is i18n-resolved at render via these keys.
const TEMPLATE_BLOCKS = ['cold', 'followup', 'finalPush'] as const satisfies
  ReadonlyArray<keyof DefaultTemplateDto>;
type TemplateBlockKey = (typeof TEMPLATE_BLOCKS)[number];

// Read-only merge tokens admins can drop into a template (shown as chips).
const TEMPLATE_TOKENS = [
  '{{Company Name}}',
  '{{Company Type}}',
  '{{city}}',
  '{{project}}',
] as const;

// Product defaults surfaced as placeholder hints on the lead-cap inputs (these
// are what the backend assumes when a cap is unset — never persisted by the form).
const LEAD_HINTS = {
  maxLeadsPerRun: '25',
  maxPerNiche: '100',
  dailySendCap: '40',
  dedupDays: '30',
} as const;

// One template block flattened to strings (subject + body), per block key.
type TemplateBlockForm = { subject: string; body: string };

// The editable subset of the config, flattened into a form. Every value is a
// string so an empty field reads as "clear the override → fall back to env":
// webhooks/url empty → null, offsets empty → null, sender '' → "use default".
// Templates + leads ride the same form: caps are strings ('' = clear), regions an
// array, and the two lead booleans are real booleans (always sent on change).
type FormState = {
  webhooks: Record<WebhookKey, string>;
  n8nApiUrl: string;
  defaultSender: '' | 'info' | 'hanna';
  followupOffsetDays: string;
  finalPushOffsetDays: string;
  templates: {
    blocks: Record<TemplateBlockKey, TemplateBlockForm>;
    signature: string;
    tone: '' | OutreachTone;
    language: '' | TemplateLanguage;
  };
  leads: {
    maxLeadsPerRun: string;
    maxPerNiche: string;
    dailySendCap: string;
    defaultRegions: string[];
    respectSuppressions: boolean;
    dedupDays: string;
    requireNicheAnalysis: boolean;
  };
};

const EMPTY_BLOCK: TemplateBlockForm = { subject: '', body: '' };

// True when no template field carries any content — that's the signal to send
// `templates.default: null` (clear the baseline) rather than three empty blocks.
function allBlocksEmpty(blocks: Record<TemplateBlockKey, TemplateBlockForm>) {
  return TEMPLATE_BLOCKS.every(
    (k) => blocks[k].subject.trim() === '' && blocks[k].body.trim() === '',
  );
}

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
    templates: {
      blocks: {
        cold: c.templates.default?.cold ?? EMPTY_BLOCK,
        followup: c.templates.default?.followup ?? EMPTY_BLOCK,
        finalPush: c.templates.default?.finalPush ?? EMPTY_BLOCK,
      },
      signature: c.templates.signature ?? '',
      tone: c.templates.tone ?? '',
      language: c.templates.language ?? '',
    },
    leads: {
      maxLeadsPerRun:
        c.leads.maxLeadsPerRun == null ? '' : String(c.leads.maxLeadsPerRun),
      maxPerNiche: c.leads.maxPerNiche == null ? '' : String(c.leads.maxPerNiche),
      dailySendCap:
        c.leads.dailySendCap == null ? '' : String(c.leads.dailySendCap),
      defaultRegions: [...c.leads.defaultRegions],
      respectSuppressions: c.leads.respectSuppressions,
      dedupDays: c.leads.dedupDays == null ? '' : String(c.leads.dedupDays),
      requireNicheAnalysis: c.leads.requireNicheAnalysis,
    },
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

// A small accessible toggle (no Switch primitive exists in this kit). An ARIA
// switch button with a sliding thumb; emerald when on, muted when off.
function Toggle({
  checked,
  onChange,
  label,
  description,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  id: string;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p id={labelId} className="text-sm font-medium">
          {label}
        </p>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          checked ? 'bg-emerald-500' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'pointer-events-none size-5 rounded-full bg-background shadow-xs transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

// An editable chip list bound to a string[]. Each region is a removable chip; the
// trailing input appends a trimmed, non-empty, non-duplicate value on Enter / Add.
function RegionChips({
  regions,
  onChange,
  addLabel,
  placeholder,
  removeAria,
}: {
  regions: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  placeholder: string;
  removeAria: (region: string) => string;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const value = draft.trim();
    if (value === '' || regions.includes(value)) {
      setDraft('');
      return;
    }
    onChange([...regions, value]);
    setDraft('');
  }

  return (
    <div className="flex flex-col gap-2">
      {regions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {regions.map((region) => (
            <span
              key={region}
              className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"
            >
              {region}
              <button
                type="button"
                onClick={() => onChange(regions.filter((r) => r !== region))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={removeAria(region)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex max-w-sm items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" onClick={add} disabled={draft.trim() === ''}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

// One tile in the lead metric strip: a big tabular number over a muted label, or a
// Skeleton while the count loads.
function StatTile({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      {loading || value == null ? (
        <Skeleton className="h-7 w-12" />
      ) : (
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
      )}
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
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

// Configuration > Templates — the per-org signature image. Unlike the other
// template fields this isn't part of the save-bar diff: upload / use-link / remove
// are immediate-action mutations (like the ingest-token controls), each refetching
// the config so the preview reflects the resolved URL. `url` is the current value
// from the resolved config (null = none set). Gate at the call site with <Can>.
function SignatureImageControl({ url }: { url: string | null }) {
  const t = useTranslations('settings');
  const upload = useUploadSignatureImage();
  const setLink = useSetSignatureImageUrl();
  const clear = useClearSignatureImage();

  // Hidden file input, driven by the visible Upload button.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [link, setLink_] = useState('');
  // The preview can 404 (a broken hotlink / dead Drive share) — track that so we
  // fall back to the empty state instead of a broken-image glyph.
  const [imgError, setImgError] = useState(false);

  const busy = upload.isPending || setLink.isPending || clear.isPending;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still fires onChange.
    e.target.value = '';
    if (!file) return;
    setImgError(false);
    upload.mutate(file, {
      onSuccess: () => toast.success(t('config.signatureImage.toastUploaded')),
      onError: (err) =>
        toast.error(err.message || t('config.signatureImage.toastError')),
    });
  }

  function handleUseLink() {
    const value = link.trim();
    if (value === '') return;
    if (!isValidUrl(value)) {
      toast.error(t('config.signatureImage.invalidUrl'));
      return;
    }
    setImgError(false);
    setLink.mutate(value, {
      onSuccess: () => {
        setLink_('');
        toast.success(t('config.signatureImage.toastLinked'));
      },
      onError: (err) =>
        toast.error(err.message || t('config.signatureImage.toastError')),
    });
  }

  function handleRemove() {
    clear.mutate(undefined, {
      onSuccess: () => toast.success(t('config.signatureImage.toastRemoved')),
      onError: (err) =>
        toast.error(err.message || t('config.signatureImage.toastError')),
    });
  }

  const showImage = url != null && !imgError;

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex flex-col gap-1">
        <Label>{t('config.signatureImage.label')}</Label>
        <p className="text-xs text-muted-foreground">
          {t('config.signatureImage.helper')}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {/* Preview tile — the image, or a muted empty state. */}
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote hotlink (Drive/served), not a local asset; next/image isn't configured for these hosts.
            <img
              src={url}
              alt={t('config.signatureImage.previewAlt')}
              className="size-full object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-1 px-2 text-center">
              <ImageOff className="size-5 text-muted-foreground" />
              <span className="text-[10px] leading-tight text-muted-foreground">
                {url != null
                  ? t('config.signatureImage.brokenPreview')
                  : t('config.signatureImage.empty')}
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Upload (hidden file input) + Remove (only when one is set). */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFile}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="size-4" />
              {upload.isPending
                ? t('config.signatureImage.uploading')
                : t('config.signatureImage.upload')}
            </Button>
            {url != null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={handleRemove}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                {clear.isPending
                  ? t('config.signatureImage.removing')
                  : t('config.signatureImage.remove')}
              </Button>
            ) : null}
          </div>

          {/* Paste a Drive/image URL → Use link. */}
          <div className="flex max-w-md items-center gap-2">
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              className="text-xs"
              placeholder={t('config.signatureImage.linkPlaceholder')}
              value={link}
              onChange={(e) => setLink_(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleUseLink();
                }
              }}
              disabled={busy}
              aria-label={t('config.signatureImage.linkLabel')}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleUseLink}
              disabled={busy || link.trim() === ''}
            >
              {setLink.isPending
                ? t('config.signatureImage.linking')
                : t('config.signatureImage.useLink')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Configuration: the editable Growth-Engine control panel, admin-only (the route
// gates on admin:config). Webhook URLs + the n8n base URL are editable overrides;
// secrets (n8n API key, ingest token) are status-only, never inputs.
export function ConfigurationSettings() {
  const t = useTranslations('settings');
  const config = useWorkflowConfig();
  const leadStats = useLeadStats();
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

  function setTemplate<K extends keyof FormState['templates']>(
    key: K,
    value: FormState['templates'][K],
  ) {
    setForm((f) =>
      f ? { ...f, templates: { ...f.templates, [key]: value } } : f,
    );
  }

  function setBlock(
    block: TemplateBlockKey,
    field: keyof TemplateBlockForm,
    value: string,
  ) {
    setForm((f) =>
      f
        ? {
            ...f,
            templates: {
              ...f.templates,
              blocks: {
                ...f.templates.blocks,
                [block]: { ...f.templates.blocks[block], [field]: value },
              },
            },
          }
        : f,
    );
  }

  function setLead<K extends keyof FormState['leads']>(
    key: K,
    value: FormState['leads'][K],
  ) {
    setForm((f) => (f ? { ...f, leads: { ...f.leads, [key]: value } } : f));
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

    // Templates — send only the changed sub-fields. `default` goes out as the full
    // 3-block object, or null when every block is blank (clear the baseline).
    const templates: NonNullable<UpdateWorkflowConfigDto['templates']> = {};
    if (
      JSON.stringify(f.templates.blocks) !== JSON.stringify(base.templates.blocks)
    ) {
      templates.default = allBlocksEmpty(f.templates.blocks)
        ? null
        : {
            cold: f.templates.blocks.cold,
            followup: f.templates.blocks.followup,
            finalPush: f.templates.blocks.finalPush,
          };
    }
    if (f.templates.signature !== base.templates.signature) {
      templates.signature =
        f.templates.signature.trim() === '' ? null : f.templates.signature;
    }
    if (f.templates.tone !== base.templates.tone) {
      templates.tone = f.templates.tone === '' ? null : f.templates.tone;
    }
    if (f.templates.language !== base.templates.language) {
      templates.language =
        f.templates.language === '' ? null : f.templates.language;
    }
    if (Object.keys(templates).length > 0) patch.templates = templates;

    // Leads — caps coerce '' → null (no cap); regions/booleans send wholesale.
    const leads: NonNullable<UpdateWorkflowConfigDto['leads']> = {};
    const capKeys = ['maxLeadsPerRun', 'maxPerNiche', 'dailySendCap', 'dedupDays'] as const;
    for (const key of capKeys) {
      if (f.leads[key] !== base.leads[key]) {
        leads[key] = f.leads[key].trim() === '' ? null : Number(f.leads[key]);
      }
    }
    if (
      JSON.stringify(f.leads.defaultRegions) !==
      JSON.stringify(base.leads.defaultRegions)
    ) {
      leads.defaultRegions = f.leads.defaultRegions;
    }
    if (f.leads.respectSuppressions !== base.leads.respectSuppressions) {
      leads.respectSuppressions = f.leads.respectSuppressions;
    }
    if (f.leads.requireNicheAnalysis !== base.leads.requireNicheAnalysis) {
      leads.requireNicheAnalysis = f.leads.requireNicheAnalysis;
    }
    if (Object.keys(leads).length > 0) patch.leads = leads;

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
    for (const cap of [
      patch.leads?.maxLeadsPerRun,
      patch.leads?.maxPerNiche,
      patch.leads?.dailySendCap,
      patch.leads?.dedupDays,
    ]) {
      if (typeof cap === 'number' && (!Number.isInteger(cap) || cap < 0)) {
        toast.error(t('config.save.invalidLeadCap'));
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

          {/* Templates — the baseline 3-block outreach sequence + signature/tone. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.templates.title')}</CardTitle>
              <CardDescription>
                {t('config.templates.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {TEMPLATE_BLOCKS.map((block) => (
                <div key={block} className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">
                    {t(`config.templates.block.${block}`)}
                  </Label>
                  <Input
                    id={`tpl-${block}-subject`}
                    value={form.templates.blocks[block].subject}
                    onChange={(e) => setBlock(block, 'subject', e.target.value)}
                    placeholder={t('config.templates.subjectPlaceholder')}
                    aria-label={t('config.templates.subjectLabel')}
                  />
                  <Textarea
                    id={`tpl-${block}-body`}
                    rows={4}
                    value={form.templates.blocks[block].body}
                    onChange={(e) => setBlock(block, 'body', e.target.value)}
                    placeholder={t('config.templates.bodyPlaceholder')}
                    aria-label={t('config.templates.bodyLabel')}
                  />
                </div>
              ))}

              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t('config.templates.tokensLabel')}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_TOKENS.map((token) => (
                    <code
                      key={token}
                      className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                    >
                      {token}
                    </code>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tpl-signature">
                  {t('config.templates.signatureLabel')}
                </Label>
                <Input
                  id="tpl-signature"
                  value={form.templates.signature}
                  onChange={(e) => setTemplate('signature', e.target.value)}
                  placeholder={t('config.templates.signaturePlaceholder')}
                />
              </div>

              {/* Per-org signature image (immediate-action; not part of the save
                  diff). admin:config is already enforced by the route, but gate it
                  here too for parity with the rest of the editing surface. */}
              <Can permission="admin:config">
                <SignatureImageControl
                  url={data.templates.signatureImageUrl ?? null}
                />
              </Can>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tpl-tone">
                    {t('config.templates.toneLabel')}
                  </Label>
                  <Select
                    value={form.templates.tone === '' ? 'unset' : form.templates.tone}
                    onValueChange={(v) =>
                      setTemplate('tone', v === 'unset' ? '' : (v as OutreachTone))
                    }
                  >
                    <SelectTrigger id="tpl-tone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">
                        {t('config.templates.unset')}
                      </SelectItem>
                      <SelectItem value="friendly">
                        {t('config.templates.toneFriendly')}
                      </SelectItem>
                      <SelectItem value="formal">
                        {t('config.templates.toneFormal')}
                      </SelectItem>
                      <SelectItem value="direct">
                        {t('config.templates.toneDirect')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tpl-language">
                    {t('config.templates.languageLabel')}
                  </Label>
                  <Select
                    value={
                      form.templates.language === '' ? 'unset' : form.templates.language
                    }
                    onValueChange={(v) =>
                      setTemplate(
                        'language',
                        v === 'unset' ? '' : (v as TemplateLanguage),
                      )
                    }
                  >
                    <SelectTrigger id="tpl-language">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">
                        {t('config.templates.unset')}
                      </SelectItem>
                      <SelectItem value="en">
                        {t('config.templates.languageEn')}
                      </SelectItem>
                      <SelectItem value="de">
                        {t('config.templates.languageDe')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Leads — lead-gen governance (caps, regions, gates) + a live metric strip. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('config.leads.title')}</CardTitle>
              <CardDescription>{t('config.leads.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="grid grid-cols-3 gap-3">
                <StatTile
                  label={t('config.leads.statLeads')}
                  value={leadStats.data?.leads}
                  loading={leadStats.isLoading}
                />
                <StatTile
                  label={t('config.leads.statProspects')}
                  value={leadStats.data?.prospects}
                  loading={leadStats.isLoading}
                />
                <StatTile
                  label={t('config.leads.statSuppressed')}
                  value={leadStats.data?.suppressed}
                  loading={leadStats.isLoading}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-max-run">
                    {t('config.leads.maxLeadsPerRunLabel')}
                  </Label>
                  <Input
                    id="lead-max-run"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="tabular-nums"
                    placeholder={LEAD_HINTS.maxLeadsPerRun}
                    value={form.leads.maxLeadsPerRun}
                    onChange={(e) => setLead('maxLeadsPerRun', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-max-niche">
                    {t('config.leads.maxPerNicheLabel')}
                  </Label>
                  <Input
                    id="lead-max-niche"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="tabular-nums"
                    placeholder={LEAD_HINTS.maxPerNiche}
                    value={form.leads.maxPerNiche}
                    onChange={(e) => setLead('maxPerNiche', e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-daily-cap">
                    {t('config.leads.dailySendCapLabel')}
                  </Label>
                  <Input
                    id="lead-daily-cap"
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="tabular-nums"
                    placeholder={LEAD_HINTS.dailySendCap}
                    value={form.leads.dailySendCap}
                    onChange={(e) => setLead('dailySendCap', e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t('config.leads.regionsLabel')}</Label>
                <p className="text-xs text-muted-foreground">
                  {t('config.leads.regionsHelper')}
                </p>
                <RegionChips
                  regions={form.leads.defaultRegions}
                  onChange={(next) => setLead('defaultRegions', next)}
                  addLabel={t('config.leads.regionsAdd')}
                  placeholder={t('config.leads.regionsPlaceholder')}
                  removeAria={(region) =>
                    t('config.leads.regionsRemove', { region })
                  }
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lead-dedup">
                  {t('config.leads.dedupLabel')}
                </Label>
                <Input
                  id="lead-dedup"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  className="max-w-[12rem] tabular-nums"
                  placeholder={LEAD_HINTS.dedupDays}
                  value={form.leads.dedupDays}
                  onChange={(e) => setLead('dedupDays', e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-4 border-t pt-4">
                <Toggle
                  id="lead-respect-suppressions"
                  checked={form.leads.respectSuppressions}
                  onChange={(next) => setLead('respectSuppressions', next)}
                  label={t('config.leads.respectSuppressionsLabel')}
                  description={t('config.leads.respectSuppressionsHelper')}
                />
                <Toggle
                  id="lead-require-niche"
                  checked={form.leads.requireNicheAnalysis}
                  onChange={(next) => setLead('requireNicheAnalysis', next)}
                  label={t('config.leads.requireNicheAnalysisLabel')}
                  description={t('config.leads.requireNicheAnalysisHelper')}
                />
              </div>
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

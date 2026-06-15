'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Crosshair } from 'lucide-react';
import { type CreateCampaignDto, slugify } from '@evertrust/shared';
import { useCreateCampaign } from '@/hooks/use-campaigns';
import { useNiches } from '@/hooks/use-niches';
import { useOrgSenders } from '@/hooks/use-arsenal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

// The AIM "Lock & Load" form, keyed by the CreateCampaignDto fields. Target is
// gone (target archetypes now live on niche_targets, derived per-niche); Region
// is a fixed zone (REGION_OPTIONS) the Lead Satellite seeds its city searches
// from; niche is pick-or-create (existing or new name).
type FormState = {
  name: string;
  nicheName: string;
  country: string;
  region: string;
  project: string;
  gmailLabel: string;
  whatsappNumber: string;
  // A per-org sender KEY (validated server-side against the org's resolved senders).
  // Sourced from the org's senders list; defaults to the org default (or 'info').
  sender: string;
};

// AIM Region zones (strict dropdown). Values are sent to n8n as-is and seed the
// Lead Satellite's city searches, so they stay stable English strings.
// "Anywhere" is the catch-all default (omitted from the Gmail label).
// "Near border (DE-PL)" targets the German–Polish border — we run German tenders,
// so near-border means BOTH sides of the DE/PL border (the n8n Lead Satellite
// expands it into border-city searches).
const REGION_OPTIONS = [
  'Anywhere',
  'North',
  'South',
  'East',
  'West',
  'Central',
  'Near border (DE-PL)',
] as const;

const EMPTY_FORM: FormState = {
  name: '',
  nicheName: '',
  country: '',
  region: 'Anywhere',
  project: '',
  gmailLabel: '',
  whatsappNumber: '',
  // sender is seeded from the org's default sender once the list loads (see the
  // effect below); 'info' is the safe initial/fallback (the wire default is 'info'
  // too) so the Select shows a valid choice before the senders query resolves.
  sender: 'info',
};

// The text inputs that must be filled before launch (niche/country/project/whatsapp
// are validated here; region + sender come from Selects that only emit valid values).
// `labelKey` indexes growth.aim.field* (resolved against the translator at submit).
const REQUIRED_TEXT: { key: keyof FormState; labelKey: string }[] = [
  { key: 'nicheName', labelKey: 'fieldNiche' },
  { key: 'country', labelKey: 'fieldCountry' },
  { key: 'project', labelKey: 'fieldProject' },
  { key: 'gmailLabel', labelKey: 'fieldGmailLabel' },
  { key: 'whatsappNumber', labelKey: 'fieldWhatsapp' },
];

// Keep only letters/digits in a label token (drops spaces + punctuation), so
// "Near Border" -> "NearBorder", "LED Retrofit" -> "LEDRetrofit".
function slugToken(s: string): string {
  return (s ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '');
}

// Auto-build the Gmail label from the AIM inputs: niche · country · zone · year
// (e.g. "LED-Germany-North-2026"). Empty until a niche is entered; the generic
// "Anywhere" zone is omitted.
function deriveGmailLabel(form: FormState): string {
  const niche = slugToken(form.nicheName);
  if (!niche) return '';
  const country = slugToken(form.country);
  const zone =
    form.region && form.region !== 'Anywhere' ? slugToken(form.region) : '';
  const year = String(new Date().getFullYear());
  return [niche, country, zone, year].filter(Boolean).join('-');
}

// AIM "Lock & Load": the top-right launch control. Opens the target form; on submit
// the create hook persists the campaign AND fires the AIM webhook server-side, so
// the success toast reflects whether it went live (ACTIVE) or saved as a DRAFT.
export function AimLaunchDialog() {
  const t = useTranslations('growth.aim');
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // The Gmail label auto-fills from the other inputs until the user edits it.
  const [labelEdited, setLabelEdited] = useState(false);
  const create = useCreateCampaign();

  // Existing org niches power the pick-or-create datalist (the user can choose one
  // or type a brand-new name; the API find-or-creates by slugify(name)). The list
  // carries `industryName`, so we sort by industry then niche and label each
  // option "Industry ▸ Niche" — display only, the value stays the bare niche name.
  const niches = useNiches(open);
  // The org's resolved senders (its own, or DEFAULT_SENDERS). Drives the From-alias
  // picker; the default-flagged sender seeds the form's initial selection.
  const senders = useOrgSenders();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Track whether the user has hand-picked a sender, so the auto-seed (below) only
  // sets the org default until they choose.
  const [senderEdited, setSenderEdited] = useState(false);

  // The org default sender key (the isDefault row, else the first sender, else
  // 'info' when the list is empty/unloaded — matching the wire default).
  const defaultSenderKey = useMemo(() => {
    const list = senders.data ?? [];
    return (list.find((s) => s.isDefault) ?? list[0])?.key ?? 'info';
  }, [senders.data]);

  // The sender Select options: the org's resolved senders, each labelled
  // "Label (email)" (or just the email). Falls back to a single 'info' option when
  // the list is empty/unloaded, and always includes the current selection so a
  // legacy key (e.g. on a pre-existing draft) still renders a valid choice.
  const senderOptions = useMemo(() => {
    const list = senders.data ?? [];
    const opts =
      list.length > 0
        ? list.map((s) => ({
            key: s.key,
            label: s.label?.trim() ? `${s.label} (${s.email})` : s.email,
          }))
        : [{ key: 'info', label: 'info@evertrust-germany.de' }];
    if (!opts.some((o) => o.key === form.sender)) {
      opts.push({ key: form.sender, label: form.sender });
    }
    return opts;
  }, [senders.data, form.sender]);

  // Seed the form's sender from the org default once the list loads, until the user
  // picks one themselves. Re-seeds when the dialog reopens (senderEdited resets in
  // reset()).
  useEffect(() => {
    if (senderEdited) return;
    setForm((f) => (f.sender === defaultSenderKey ? f : { ...f, sender: defaultSenderKey }));
  }, [defaultSenderKey, senderEdited]);

  // Niche options grouped by industry: industries first (alphabetical), Unassigned
  // last; niches alphabetical within each. `optionLabel` is what the datalist shows.
  const nicheOptions = useMemo(() => {
    const unassignedLabel = t('nicheUnassignedGroup');
    return [...(niches.data ?? [])]
      .map((n) => ({
        id: n.id,
        name: n.name,
        industry: n.industryName,
        optionLabel: n.industryName
          ? `${n.industryName} ▸ ${n.name}`
          : `${unassignedLabel} ▸ ${n.name}`,
      }))
      .sort((a, b) => {
        // Unassigned (null industry) sorts after every named industry.
        if (a.industry !== b.industry) {
          if (a.industry === null) return 1;
          if (b.industry === null) return -1;
          return a.industry.localeCompare(b.industry);
        }
        return a.name.localeCompare(b.name);
      });
  }, [niches.data, t]);

  // Does the typed niche already exist (case/space-insensitive via the shared slug)?
  // Drives a small "new niche" hint so the user knows one will be created.
  const nicheIsNew = useMemo(() => {
    const slug = slugify(form.nicheName);
    if (!slug) return false;
    return !(niches.data ?? []).some((n) => n.slug === slug);
  }, [form.nicheName, niches.data]);

  // Keep the Gmail label in sync with niche/country/zone (+ year) until the user
  // types their own.
  useEffect(() => {
    if (labelEdited) return;
    setForm((f) => {
      const next = deriveGmailLabel(f);
      return f.gmailLabel === next ? f : { ...f, gmailLabel: next };
    });
  }, [form.nicheName, form.country, form.region, labelEdited]);

  function reset() {
    setForm(EMPTY_FORM);
    setLabelEdited(false);
    setSenderEdited(false);
  }

  function submit() {
    const missing = REQUIRED_TEXT.filter((f) => !form[f.key].trim());
    if (!form.region) missing.push({ key: 'region', labelKey: 'fieldRegion' });
    if (missing.length > 0) {
      toast.error(
        t('validationMissing', {
          fields: missing.map((m) => t(m.labelKey)).join(', '),
        }),
      );
      return;
    }
    const input: CreateCampaignDto = {
      nicheName: form.nicheName.trim(),
      country: form.country.trim(),
      region: form.region.trim(),
      project: form.project.trim(),
      gmailLabel: form.gmailLabel.trim(),
      // Calendar is pinned to info@ in Reply Glock, so there's no picker — the
      // required salesCalendarId is sent as info@.
      salesCalendarId: 'info@evertrust-germany.de',
      whatsappNumber: form.whatsappNumber.trim(),
      sender: form.sender,
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
    };
    create.mutate(input, {
      onSuccess: (c) => {
        toast.success(
          c.lifecycle === 'DRAFT'
            ? t('toastDraft', { project: c.project })
            : t('toastLaunched', { project: c.project }),
        );
        setOpen(false);
        reset();
      },
      onError: (error) => toast.error(error.message ?? t('toastError')),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Crosshair />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {/* Name (optional) */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-name`}>
              {t('nameLabel')}
              <span className="text-muted-foreground">{t('nameOptional')}</span>
            </Label>
            <Input
              id={`${fieldId}-name`}
              value={form.name}
              placeholder={t('namePlaceholder')}
              maxLength={60}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Niche — pick an existing one or type a new name (API find-or-creates).
              Options are grouped/labelled by industry (display only). */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-niche`}>{t('nicheLabel')}</Label>
            <Input
              id={`${fieldId}-niche`}
              list={`${fieldId}-niche-options`}
              value={form.nicheName}
              placeholder={t('nichePlaceholder')}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('nicheName', e.target.value)}
            />
            <datalist id={`${fieldId}-niche-options`}>
              {nicheOptions.map((n) => (
                <option key={n.id} value={n.name} label={n.optionLabel} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              {nicheIsNew ? t('nicheHintNew') : t('nicheHintExisting')}
            </p>
          </div>

          {/* Country */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-country`}>{t('countryLabel')}</Label>
            <Input
              id={`${fieldId}-country`}
              value={form.country}
              placeholder={t('countryPlaceholder')}
              maxLength={120}
              onChange={(e) => set('country', e.target.value)}
            />
          </div>

          {/* Region — a fixed zone the Lead Satellite seeds its city searches
              from. "Near border (DE-PL)" = the German–Polish border (both sides). */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-region`}>{t('regionLabel')}</Label>
            <Select
              value={form.region}
              onValueChange={(v) => set('region', v)}
            >
              <SelectTrigger id={`${fieldId}-region`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Project */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-project`}>{t('projectLabel')}</Label>
            <Input
              id={`${fieldId}-project`}
              value={form.project}
              placeholder={t('projectPlaceholder')}
              maxLength={200}
              onChange={(e) => set('project', e.target.value)}
            />
          </div>

          {/* Gmail label — auto-derived until edited */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-gmailLabel`}>{t('gmailLabel')}</Label>
            <Input
              id={`${fieldId}-gmailLabel`}
              value={form.gmailLabel}
              placeholder={t('gmailPlaceholder')}
              maxLength={120}
              onChange={(e) => {
                setLabelEdited(true);
                set('gmailLabel', e.target.value);
              }}
            />
            {!labelEdited ? (
              <p className="text-xs text-muted-foreground">{t('gmailHint')}</p>
            ) : null}
          </div>

          {/* WhatsApp number */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-whatsappNumber`}>
              {t('whatsappLabel')}
            </Label>
            <Input
              id={`${fieldId}-whatsappNumber`}
              value={form.whatsappNumber}
              placeholder={t('whatsappPlaceholder')}
              maxLength={40}
              onChange={(e) => set('whatsappNumber', e.target.value)}
            />
          </div>

          {/* Sender alias — which org mailbox BAZOOKA sends from. Options come from
              the org's resolved senders; the default-flagged one is pre-selected. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-sender`}>{t('senderLabel')}</Label>
            <Select
              value={form.sender}
              onValueChange={(v) => {
                setSenderEdited(true);
                set('sender', v);
              }}
            >
              <SelectTrigger id={`${fieldId}-sender`} className="w-full">
                <SelectValue placeholder="info" />
              </SelectTrigger>
              <SelectContent>
                {senderOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('senderHint')}</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

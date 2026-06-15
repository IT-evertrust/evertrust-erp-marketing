'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Crosshair } from 'lucide-react';
import {
  type CreateCampaignDto,
  type CampaignSender,
  CAMPAIGN_SENDERS,
  CAMPAIGN_SENDER_LABELS,
  slugify,
} from '@evertrust/shared';
import { useCreateCampaign } from '@/hooks/use-campaigns';
import { useNiches } from '@/hooks/use-niches';
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
  sender: CampaignSender;
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
  // sender defaults to info@ so its Select shows a valid choice and submit never
  // posts an empty value (the wire default is also 'info').
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
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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

          {/* Sender alias — which Gmail identity BAZOOKA sends from */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-sender`}>{t('senderLabel')}</Label>
            <Select
              value={form.sender}
              onValueChange={(v) => set('sender', v as CampaignSender)}
            >
              <SelectTrigger id={`${fieldId}-sender`} className="w-full">
                <SelectValue placeholder="info" />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_SENDERS.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {CAMPAIGN_SENDER_LABELS[opt]}
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

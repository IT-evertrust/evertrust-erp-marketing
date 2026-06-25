'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useOrgCalendars, useOrgSenders } from '@/hooks/use-arsenal';
import { useNiches } from '@/hooks/use-niches';
import { Button } from '@/components/ui/button';
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

import type { NewCampaignFormValues } from '../types';

type NewCampaignModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: NewCampaignFormValues) => void;
  submitting?: boolean;
};

// AIM Region zones (strict dropdown). Values are sent to the Reach create-aim
// endpoint as-is and seed the Lead Satellite's city searches, so they stay stable
// English strings. "Anywhere" is the catch-all default (omitted from the Gmail
// label). "Border-DE" targets the German border regions.
const REGION_OPTIONS = [
  'Anywhere',
  'North',
  'South',
  'East',
  'West',
  'Border-DE',
] as const;

// Default country for new aims (free-text, editable).
const DEFAULT_COUNTRY = 'Germany';

const EMPTY_FORM: NewCampaignFormValues = {
  name: '',
  niche: '',
  country: DEFAULT_COUNTRY,
  region: 'Anywhere',
  project: '',
  gmailLabel: '',
  whatsappNumber: '',
  // Seeded from the org's default sender once the list loads (see effect); 'info'
  // is the safe initial/fallback so the Select shows a valid choice meanwhile.
  sender: 'info',
  // Seeded from the org's primary calendar once the scan loads (see effect); ''
  // means "use the org default" (Google not connected).
  salesCalendarId: '',
};

// Keep only letters/digits in a label token (drops spaces + punctuation), so
// "Border-DE" -> "BorderDE", "LED Retrofit" -> "LEDRetrofit".
function slugToken(s: string): string {
  return (s ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '');
}

// Auto-build the Gmail label from the AIM inputs: niche · country · zone · year
// (e.g. "LED-Germany-North-2026"). Empty until a niche is entered; the generic
// "Anywhere" zone is omitted.
function deriveGmailLabel(form: NewCampaignFormValues): string {
  const niche = slugToken(form.niche);
  if (!niche) return '';
  const country = slugToken(form.country);
  const zone =
    form.region && form.region !== 'Anywhere' ? slugToken(form.region) : '';
  const year = String(new Date().getFullYear());
  return [niche, country, zone, year].filter(Boolean).join('-');
}

// Reach "New Aim" modal — the AIM "Lock & Load" form (mirrors main's
// aim-launch-dialog field-for-field: Niche picked from the org's Sectors, Country
// free-text, Region zone dropdown, auto-derived Gmail label, Sender select from the
// org's resolved senders, Calendar select from the org's Google scan) but submits
// the Reach aim shape so the existing create-aim endpoint (reach_aims) is untouched.
export function NewCampaignModal({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewCampaignModalProps) {
  const t = useTranslations('reach');
  const fieldId = useId();
  const [form, setForm] = useState<NewCampaignFormValues>(EMPTY_FORM);
  // The Gmail label auto-fills from the other inputs until the user edits it.
  const [labelEdited, setLabelEdited] = useState(false);
  const [senderEdited, setSenderEdited] = useState(false);
  const [calendarEdited, setCalendarEdited] = useState(false);

  // Existing org niches power the Niche picker (gated on open); the org's resolved
  // senders drive the From-alias picker; the org's Google calendars (gated on open)
  // drive the calendar picker.
  const niches = useNiches(open);
  const senders = useOrgSenders();
  const calendars = useOrgCalendars(open);

  const set = <K extends keyof NewCampaignFormValues>(
    key: K,
    value: NewCampaignFormValues[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  // Reset whenever the dialog closes — whether the user cancelled or the parent
  // closed it after a successful create. On error the parent keeps it open, so the
  // typed input is preserved.
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setLabelEdited(false);
      setSenderEdited(false);
      setCalendarEdited(false);
    }
  }, [open]);

  // The org default sender key (the isDefault row, else the first, else 'info').
  const defaultSenderKey = useMemo(() => {
    const list = senders.data ?? [];
    return (list.find((s) => s.isDefault) ?? list[0])?.key ?? 'info';
  }, [senders.data]);

  // Sender options labelled "Label (email)"; always includes the current value so a
  // legacy key still renders, and falls back to a single 'info' option when empty.
  const senderOptions = useMemo(() => {
    const list = senders.data ?? [];
    const opts =
      list.length > 0
        ? list.map((s) => ({
            key: s.key,
            label: s.label?.trim() ? `${s.label} (${s.email})` : s.email,
          }))
        : [{ key: 'info', label: 'info' }];
    if (!opts.some((o) => o.key === form.sender)) {
      opts.push({ key: form.sender, label: form.sender });
    }
    return opts;
  }, [senders.data, form.sender]);

  // Seed the sender from the org default once the list loads, until the user picks.
  useEffect(() => {
    if (senderEdited) return;
    setForm((f) =>
      f.sender === defaultSenderKey ? f : { ...f, sender: defaultSenderKey },
    );
  }, [defaultSenderKey, senderEdited]);

  // True only when the org has a Google token wired AND the live scan succeeded.
  const calendarsConfigured = calendars.data?.configured ?? false;

  // The calendar Select options (label = calendar summary, value = its id).
  const calendarOptions = useMemo(
    () =>
      (calendars.data?.calendars ?? []).map((c) => ({
        value: c.id,
        label: c.summary,
      })),
    [calendars.data],
  );

  // Seed the calendar from the org's primary calendar once the scan loads (else the
  // first calendar), until the user picks one themselves.
  useEffect(() => {
    if (calendarEdited) return;
    const list = calendars.data?.calendars ?? [];
    const pick = list.find((c) => c.primary) ?? list[0];
    if (!pick) return;
    const seed = pick.id;
    setForm((f) =>
      f.salesCalendarId === seed ? f : { ...f, salesCalendarId: seed },
    );
  }, [calendars.data, calendarEdited]);

  // Niche options grouped "Industry ▸ Niche": industries first (alphabetical),
  // Unassigned last; niches alphabetical within each.
  const nicheOptions = useMemo(() => {
    return [...(niches.data ?? [])]
      .map((n) => ({
        id: n.id,
        name: n.name,
        industry: n.industryName,
        optionLabel: n.industryName ? `${n.industryName} ▸ ${n.name}` : n.name,
      }))
      .sort((a, b) => {
        if (a.industry !== b.industry) {
          if (a.industry === null) return 1;
          if (b.industry === null) return -1;
          return (a.industry ?? '').localeCompare(b.industry ?? '');
        }
        return a.name.localeCompare(b.name);
      });
  }, [niches.data]);

  // The chosen niche's id, derived from the stored name (the Select value). We still
  // submit the niche NAME (free-text on reach_aims).
  const selectedNicheId = useMemo(
    () => (niches.data ?? []).find((n) => n.name === form.niche)?.id,
    [niches.data, form.niche],
  );

  // Keep the Gmail label in sync with niche/country/zone (+ year) until the user
  // types their own.
  useEffect(() => {
    if (labelEdited) return;
    setForm((f) => {
      const next = deriveGmailLabel(f);
      return f.gmailLabel === next ? f : { ...f, gmailLabel: next };
    });
  }, [form.niche, form.country, form.region, labelEdited]);

  function submit() {
    if (!form.name.trim() || !form.niche.trim() || !form.region.trim()) {
      toast.error(t('modal.validation'));
      return;
    }
    onSubmit({
      name: form.name.trim(),
      niche: form.niche.trim(),
      country: form.country.trim(),
      region: form.region.trim(),
      project: form.project.trim(),
      gmailLabel: form.gmailLabel.trim(),
      whatsappNumber: form.whatsappNumber.trim(),
      sender: form.sender,
      salesCalendarId: form.salesCalendarId.trim(),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('modal.title')}</DialogTitle>
          <DialogDescription>{t('modal.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid items-start gap-x-6 gap-y-5 sm:grid-cols-2">
          {/* Campaign name — full width above the paired fields. */}
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor={`${fieldId}-name`}>{t('modal.field.name')}</Label>
            <Input
              id={`${fieldId}-name`}
              value={form.name}
              placeholder={t('modal.field.namePlaceholder')}
              maxLength={120}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Niche — pick from the org's Sectors, grouped/labelled by industry;
              free-text fallback when none exist yet so aim creation is never blocked.
              Stores the niche NAME (free-text on reach_aims). */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-niche`}>{t('modal.field.niche')}</Label>
            {nicheOptions.length > 0 ? (
              <Select
                value={selectedNicheId}
                onValueChange={(id) =>
                  set(
                    'niche',
                    (niches.data ?? []).find((n) => n.id === id)?.name ?? '',
                  )
                }
              >
                <SelectTrigger id={`${fieldId}-niche`} className="w-full">
                  <SelectValue placeholder={t('modal.field.nichePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {nicheOptions.map((n) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.optionLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`${fieldId}-niche`}
                value={form.niche}
                placeholder={t('modal.field.nichePlaceholder')}
                maxLength={120}
                onChange={(e) => set('niche', e.target.value)}
              />
            )}
          </div>

          {/* Country — free-text, defaults to Germany. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-country`}>
              {t('modal.field.country')}
            </Label>
            <Input
              id={`${fieldId}-country`}
              value={form.country}
              placeholder={t('modal.field.countryPlaceholder')}
              maxLength={120}
              onChange={(e) => set('country', e.target.value)}
            />
          </div>

          {/* Region — a fixed zone the Lead Satellite seeds its city searches
              from. "Anywhere" → nationwide; "Border-DE" → the German border. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-region`}>{t('modal.field.region')}</Label>
            <Select value={form.region} onValueChange={(v) => set('region', v)}>
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
            <Label htmlFor={`${fieldId}-project`}>
              {t('modal.field.project')}
            </Label>
            <Input
              id={`${fieldId}-project`}
              value={form.project}
              placeholder={t('modal.field.projectPlaceholder')}
              maxLength={200}
              onChange={(e) => set('project', e.target.value)}
            />
          </div>

          {/* Gmail label — auto-derived until edited. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-gmailLabel`}>
              {t('modal.field.gmailLabel')}
            </Label>
            <Input
              id={`${fieldId}-gmailLabel`}
              value={form.gmailLabel}
              placeholder={t('modal.field.gmailLabelPlaceholder')}
              maxLength={120}
              onChange={(e) => {
                setLabelEdited(true);
                set('gmailLabel', e.target.value);
              }}
            />
            {!labelEdited ? (
              <p className="text-xs text-muted-foreground">
                {t('modal.field.gmailLabelHint')}
              </p>
            ) : null}
          </div>

          {/* WhatsApp number */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-whatsappNumber`}>
              {t('modal.field.whatsapp')}
            </Label>
            <Input
              id={`${fieldId}-whatsappNumber`}
              value={form.whatsappNumber}
              placeholder={t('modal.field.whatsappPlaceholder')}
              maxLength={40}
              onChange={(e) => set('whatsappNumber', e.target.value)}
            />
          </div>

          {/* Sender alias — which org mailbox sends from. Options come from the
              org's resolved senders; the default-flagged one is pre-selected. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-sender`}>{t('modal.field.sender')}</Label>
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
          </div>

          {/* Sales calendar — which Google calendar meetings book into. Rendered
              only when the org's Google token is wired and the scan returned
              calendars; otherwise a helper note says the org-default is used. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-salesCalendarId`}>
              {t('modal.field.calendar')}
            </Label>
            {calendarsConfigured && calendarOptions.length > 0 ? (
              <Select
                value={form.salesCalendarId}
                onValueChange={(v) => {
                  setCalendarEdited(true);
                  set('salesCalendarId', v);
                }}
              >
                <SelectTrigger
                  id={`${fieldId}-salesCalendarId`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {calendarOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t('modal.field.calendarNotConnected')}
              </p>
            )}
          </div>

          {/* {{Type}} / {{IndustryFocus}} / {{TenderFocus}} are auto-derived from the
              selected niche's Sector on the server (Type ← first enabled target,
              IndustryFocus ← parent industry, TenderFocus ← niche name) — no raw inputs. */}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            {t('modal.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? t('modal.submitting') : t('modal.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

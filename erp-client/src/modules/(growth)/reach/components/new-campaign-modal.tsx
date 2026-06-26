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

// AIM Region zones (strict dropdown). Sent to the create-aim endpoint as-is and
// seed the Lead Satellite's city searches. "Anywhere" is the catch-all default.
const REGION_OPTIONS = [
  'Anywhere',
  'North',
  'South',
  'East',
  'West',
  'Border-DE',
] as const;

// Target country for the aim (drives the scraper's geo step). Germany-first, then
// the DACH + neighbouring markets EverTrust works. Sent to create-aim as-is.
const COUNTRY_OPTIONS = [
  'Germany',
  'Austria',
  'Switzerland',
  'Netherlands',
  'Belgium',
  'Luxembourg',
  'France',
  'Poland',
  'Czechia',
  'Denmark',
] as const;

// Default country for new aims.
const DEFAULT_COUNTRY = 'Germany';

const EMPTY_FORM: NewCampaignFormValues = {
  name: '',
  niche: '',
  country: DEFAULT_COUNTRY,
  region: 'Anywhere',
  segment: '',
  project: '',
  gmailLabel: '',
  whatsappNumber: '',
  // Seeded from the org's default sender once the list loads (see effect); 'info'
  // is the safe initial/fallback.
  sender: 'info',
  // Seeded from the org's primary calendar once the scan loads (see effect); ''
  // means "use the org default".
  salesCalendarId: '',
};

// Keep only letters/digits in a label token.
function slugToken(s: string): string {
  return (s ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '');
}

// Auto-build the Gmail label from the AIM inputs: niche · country · zone · year.
function deriveGmailLabel(form: NewCampaignFormValues): string {
  const niche = slugToken(form.niche);
  if (!niche) return '';
  const country = slugToken(form.country);
  const zone =
    form.region && form.region !== 'Anywhere' ? slugToken(form.region) : '';
  const year = String(new Date().getFullYear());
  return [niche, country, zone, year].filter(Boolean).join('-');
}

// Reach "New Scraper Campaign" modal — the trimmed AIM intake (Campaign Name ·
// Niche · Region · Segment), styled after the Saloot demo. The richer per-aim
// controls (Country, Gmail label, WhatsApp, Sender mailbox, Sales calendar) are no
// longer surfaced here: their values are seeded from the org's defaults and still
// submitted, so the existing create-aim endpoint (reach_aims) is untouched and the
// scrape/sender/calendar wiring keeps working. The previous full form is preserved
// on disk as `new-campaign-modal-legacy.tsx`.
export function NewCampaignModal({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewCampaignModalProps) {
  const t = useTranslations('reach');
  const fieldId = useId();
  const [form, setForm] = useState<NewCampaignFormValues>(EMPTY_FORM);
  // These edited-flags gate the invisible org-default seeding below — once seeded
  // they stay put (the user can't edit them in the trimmed UI).
  const [senderSeeded, setSenderSeeded] = useState(false);
  const [calendarSeeded, setCalendarSeeded] = useState(false);

  // Org niches power the Niche picker; the org's resolved senders + Google
  // calendars feed the invisible sender/calendar defaults that still get submitted.
  const niches = useNiches(open);
  const senders = useOrgSenders();
  const calendars = useOrgCalendars(open);

  const set = <K extends keyof NewCampaignFormValues>(
    key: K,
    value: NewCampaignFormValues[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  // Reset whenever the dialog closes (cancel or post-create). On error the parent
  // keeps it open, so typed input is preserved.
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setSenderSeeded(false);
      setCalendarSeeded(false);
    }
  }, [open]);

  // The org default sender key (the isDefault row, else first, else 'info').
  const defaultSenderKey = useMemo(() => {
    const list = senders.data ?? [];
    return (list.find((s) => s.isDefault) ?? list[0])?.key ?? 'info';
  }, [senders.data]);

  // Seed the (invisible) sender from the org default once the list loads.
  useEffect(() => {
    if (senderSeeded) return;
    setForm((f) => ({ ...f, sender: defaultSenderKey }));
    if (senders.data) setSenderSeeded(true);
  }, [defaultSenderKey, senders.data, senderSeeded]);

  // Seed the (invisible) calendar from the org's primary calendar once the scan
  // loads (else the first calendar).
  useEffect(() => {
    if (calendarSeeded) return;
    const list = calendars.data?.calendars ?? [];
    const pick = list.find((c) => c.primary) ?? list[0];
    if (pick) setForm((f) => ({ ...f, salesCalendarId: pick.id }));
    if (calendars.data) setCalendarSeeded(true);
  }, [calendars.data, calendarSeeded]);

  // Niche options grouped "Industry ▸ Niche".
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

  // The chosen niche's id, derived from the stored name (we submit the NAME).
  const selectedNicheId = useMemo(
    () => (niches.data ?? []).find((n) => n.name === form.niche)?.id,
    [niches.data, form.niche],
  );

  function submit() {
    if (!form.name.trim() || !form.niche.trim() || !form.region.trim()) {
      toast.error(t('modal.validation'));
      return;
    }
    // Build the full payload: the 4 visible fields + the org-default-seeded
    // sender/calendar/country, with a freshly derived Gmail label, so the
    // create-aim contract is unchanged.
    const values: NewCampaignFormValues = {
      name: form.name.trim(),
      niche: form.niche.trim(),
      country: (form.country || DEFAULT_COUNTRY).trim(),
      region: form.region.trim(),
      segment: (form.segment ?? '').trim(),
      project: '',
      gmailLabel: deriveGmailLabel(form),
      whatsappNumber: '',
      sender: form.sender,
      salesCalendarId: form.salesCalendarId.trim(),
    };
    onSubmit(values);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('modal.title')}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 py-1">
          {/* Campaign name — full width. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-name`}>{t('modal.field.name')}</Label>
            <Input
              id={`${fieldId}-name`}
              value={form.name}
              placeholder={t('modal.field.namePlaceholder')}
              maxLength={120}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Niche + Region — stacked vertically (one field per row) like the rest of
              the form, so the two controls can never crowd / overlap. */}
          <div className="grid gap-5">
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

            <div className="grid gap-2">
              <Label htmlFor={`${fieldId}-country`}>{t('modal.field.country')}</Label>
              <Select value={form.country} onValueChange={(v) => set('country', v)}>
                <SelectTrigger id={`${fieldId}-country`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
          </div>

          {/* Segment — free-text target descriptor. */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-segment`}>{t('modal.field.segment')}</Label>
            <Input
              id={`${fieldId}-segment`}
              value={form.segment ?? ''}
              placeholder={t('modal.field.segmentPlaceholder')}
              maxLength={200}
              onChange={(e) => set('segment', e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? t('modal.submitting') : t('modal.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

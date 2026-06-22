'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { useOrgSenders } from '@/hooks/use-arsenal';
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

// AIM Region zones — the same strict set as main's "Lock & Load" launcher. The
// Lead Satellite seeds its city searches from these, so the values stay stable
// English strings ("Anywhere" is the catch-all default).
const REGION_OPTIONS = [
  'Anywhere',
  'North',
  'South',
  'East',
  'West',
  'Central',
  'Near border (DE-PL)',
] as const;

const EMPTY_FORM: NewCampaignFormValues = {
  name: '',
  niche: '',
  region: 'Anywhere',
  segment: '',
  source: '',
  // Seeded from the org's default sender once the list loads (see effect); 'info'
  // is the safe initial/fallback so the Select shows a valid choice meanwhile.
  sender: 'info',
};

// Reach "New Aim" modal — adopts main's AIM "Lock & Load" design (org-aware shadcn
// Dialog: Niche picked from the org's Sectors, Region zone dropdown, Sender select
// from the org's resolved senders) but submits the lean Reach aim shape so the
// existing create-aim endpoint (reach_aims) is untouched.
export function NewCampaignModal({
  open,
  onClose,
  onSubmit,
  submitting = false,
}: NewCampaignModalProps) {
  const t = useTranslations('reach');
  const fieldId = useId();
  const [form, setForm] = useState<NewCampaignFormValues>(EMPTY_FORM);
  const [senderEdited, setSenderEdited] = useState(false);

  // Existing org niches power the Niche picker (gated on open); the org's resolved
  // senders drive the From-alias picker.
  const niches = useNiches(open);
  const senders = useOrgSenders();

  const set = <K extends keyof NewCampaignFormValues>(
    key: K,
    value: NewCampaignFormValues[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  // Reset whenever the dialog closes — whether the user cancelled or the parent
  // closed it after a successful create. On error the parent keeps it open, so the
  // typed input is preserved (unlike the old modal, which wiped on submit).
  useEffect(() => {
    if (!open) {
      setForm(EMPTY_FORM);
      setSenderEdited(false);
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

  function submit() {
    if (!form.name.trim() || !form.niche.trim() || !form.region.trim()) {
      toast.error(t('modal.validation'));
      return;
    }
    onSubmit({
      name: form.name.trim(),
      niche: form.niche.trim(),
      region: form.region.trim(),
      segment: form.segment.trim(),
      source: form.source.trim(),
      sender: form.sender,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
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

          {/* Niche — pick from the org's Sectors; free-text fallback when none exist
              yet so aim creation is never blocked. */}
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

          {/* Region — fixed zone the Lead Satellite seeds city searches from. */}
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

          {/* Segment */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-segment`}>{t('modal.field.segment')}</Label>
            <Input
              id={`${fieldId}-segment`}
              value={form.segment}
              placeholder={t('modal.field.segmentPlaceholder')}
              maxLength={200}
              onChange={(e) => set('segment', e.target.value)}
            />
          </div>

          {/* Source */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-source`}>{t('modal.field.source')}</Label>
            <Input
              id={`${fieldId}-source`}
              value={form.source}
              placeholder={t('modal.field.sourcePlaceholder')}
              maxLength={120}
              onChange={(e) => set('source', e.target.value)}
            />
          </div>

          {/* Sender alias — which org mailbox sends from. Full width. */}
          <div className="grid gap-2 sm:col-span-2">
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

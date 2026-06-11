'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Crosshair } from 'lucide-react';
import {
  type CreateCampaignDto,
  type CampaignRegion,
  type CampaignSender,
  CAMPAIGN_REGIONS,
  CAMPAIGN_SENDERS,
  CAMPAIGN_SENDER_LABELS,
} from '@evertrust/shared';
import { useCreateCampaign } from '@/hooks/use-campaigns';
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

// The 9 AIM inputs (matches the reference Growth-Engine form). `name` is the only
// optional one. Keyed by the CreateCampaignDto field so the payload is built
// directly from the form state.
type Field = {
  key: keyof CreateCampaignDto;
  label: string;
  placeholder: string;
  required: boolean;
  // When set, the field renders as a dropdown of these fixed choices instead of
  // a free-text input (e.g. the location zone).
  options?: readonly string[];
  // Optional display labels for `options` when the shown text differs from the
  // submitted value (e.g. sender key 'hanna' shown as 'hanna@evertrust-germany.de').
  optionLabels?: Record<string, string>;
};

const FIELDS: readonly Field[] = [
  { key: 'name', label: 'Name', placeholder: 'Name this attack (optional)', required: false },
  { key: 'niche', label: 'Niche', placeholder: 'LED', required: true },
  { key: 'target', label: 'Target', placeholder: 'EPC, Installer, Operator…', required: true },
  { key: 'country', label: 'Country', placeholder: 'Germany', required: true },
  { key: 'state', label: 'State / City', placeholder: 'Select a region', required: true, options: CAMPAIGN_REGIONS },
  { key: 'project', label: 'Project', placeholder: 'LED Retrofit Berlin 2026', required: true },
  { key: 'gmailLabel', label: 'Gmail label', placeholder: 'LED-Berlin-2026', required: true },
  { key: 'whatsappNumber', label: 'WhatsApp number', placeholder: '+49…', required: true },
  { key: 'sender', label: 'Send from', placeholder: 'info@evertrust-germany.de', required: true, options: CAMPAIGN_SENDERS, optionLabels: CAMPAIGN_SENDER_LABELS },
];

// Keep only letters/digits in a label token (drops spaces + punctuation), so
// "Near Border" -> "NearBorder", "LED Retrofit" -> "LEDRetrofit".
function slugToken(s: string): string {
  return (s ?? '').trim().replace(/[^a-zA-Z0-9]+/g, '');
}

// Auto-build the Gmail label from the AIM inputs: niche · country · zone · year
// (e.g. "LED-Germany-North-2026"). Empty until a niche is entered; the generic
// "Anywhere" zone is omitted.
function deriveGmailLabel(
  form: Partial<Record<keyof CreateCampaignDto, string>>,
): string {
  const niche = slugToken(form.niche ?? '');
  if (!niche) return '';
  const country = slugToken(form.country ?? '');
  const zone =
    form.state && form.state !== 'Anywhere' ? slugToken(form.state) : '';
  const year = String(new Date().getFullYear());
  return [niche, country, zone, year].filter(Boolean).join('-');
}

// AIM "Lock & Load": the top-right launch control. Opens the target form; on submit
// the create hook persists the campaign AND fires the AIM webhook server-side, so
// the success toast reflects the actual deploy outcome (DEPLOYED / DRAFT / FAILED).
export function AimLaunchDialog() {
  const [open, setOpen] = useState(false);
  // sender defaults to info@ so its dropdown shows a valid choice and submit never
  // posts an empty value. (Calendar is pinned to info@ in Reply Glock, so the old
  // "Sales calendar" picker was removed; salesCalendarId is sent as info@ below.)
  const [form, setForm] = useState<Partial<Record<keyof CreateCampaignDto, string>>>({ sender: 'info' });
  // The Gmail label auto-fills from the other inputs until the user edits it.
  const [labelEdited, setLabelEdited] = useState(false);
  const create = useCreateCampaign();

  const set = (key: keyof CreateCampaignDto, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  const val = (key: keyof CreateCampaignDto) => (form[key] ?? '').trim();

  // Keep the Gmail label in sync with niche/country/zone (+ year) until the user
  // types their own. Stored on the form so submit + the required check just work.
  useEffect(() => {
    if (labelEdited) return;
    setForm((f) => {
      const next = deriveGmailLabel(f);
      return f.gmailLabel === next ? f : { ...f, gmailLabel: next };
    });
  }, [form.niche, form.country, form.state, labelEdited]);

  function submit() {
    const missing = FIELDS.filter((f) => f.required && !val(f.key));
    if (missing.length > 0) {
      toast.error(`Fill in: ${missing.map((m) => m.label).join(', ')}.`);
      return;
    }
    const input: CreateCampaignDto = {
      niche: val('niche'),
      target: val('target'),
      country: val('country'),
      // The Select only ever emits a valid region (and required-field check above
      // guarantees it's set); server-side zod re-validates on the wire.
      state: val('state') as CampaignRegion,
      project: val('project'),
      gmailLabel: val('gmailLabel'),
      salesCalendarId: 'info@evertrust-germany.de',
      whatsappNumber: val('whatsappNumber'),
      sender: (val('sender') as CampaignSender) || 'info',
      ...(val('name') ? { name: val('name') } : {}),
    };
    create.mutate(input, {
      onSuccess: (c) => {
        toast.success(
          c.status === 'DEPLOYED'
            ? `Locked & loaded — campaign deployed (${c.project}).`
            : c.status === 'FAILED'
              ? `Saved, but the AIM deploy failed: ${c.deployError ?? 'unknown error'}`
              : `Saved as draft (${c.project}) — the AIM webhook isn't configured yet.`,
        );
        setOpen(false);
        setForm({ sender: 'info' });
        setLabelEdited(false);
      },
      onError: (error) => toast.error(error.message ?? 'Launch failed.'),
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Crosshair />
          AIM
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AIM — set the target</DialogTitle>
          <DialogDescription>
            Lock &amp; Load launches the campaign: the ERP provisions the Drive
            folder via n8n, then the arsenal runs autonomously.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="grid gap-2">
              <Label htmlFor={`aim-${f.key}`}>
                {f.label}
                {f.required ? null : (
                  <span className="text-muted-foreground"> (optional)</span>
                )}
              </Label>
              {f.options ? (
                <Select
                  value={form[f.key] ?? ''}
                  onValueChange={(v) => set(f.key, v)}
                >
                  <SelectTrigger id={`aim-${f.key}`} className="w-full">
                    <SelectValue placeholder={f.placeholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {f.optionLabels?.[opt] ?? opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`aim-${f.key}`}
                  value={form[f.key] ?? ''}
                  placeholder={f.placeholder}
                  maxLength={f.key === 'name' ? 60 : 200}
                  onChange={(e) => {
                    if (f.key === 'gmailLabel') setLabelEdited(true);
                    set(f.key, e.target.value);
                  }}
                />
              )}
              {f.key === 'gmailLabel' && !labelEdited ? (
                <p className="text-xs text-muted-foreground">
                  Auto-generated from niche · country · zone · year — edit to
                  override.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Launching…' : 'Lock & Load'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

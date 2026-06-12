'use client';

import { useEffect, useId, useMemo, useState } from 'react';
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
// gone (target archetypes now live on niche_targets, derived per-niche); the old
// "State / City" is renamed Region (still free text — a city/voivodeship the Lead
// Satellite expands into searches); niche is pick-or-create (existing or new name).
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

const EMPTY_FORM: FormState = {
  name: '',
  nicheName: '',
  country: '',
  region: '',
  project: '',
  gmailLabel: '',
  whatsappNumber: '',
  // sender defaults to info@ so its Select shows a valid choice and submit never
  // posts an empty value (the wire default is also 'info').
  sender: 'info',
};

// The text inputs that must be filled before launch (niche/country/project/whatsapp
// are validated here; region + sender come from Selects that only emit valid values).
const REQUIRED_TEXT: { key: keyof FormState; label: string }[] = [
  { key: 'nicheName', label: 'Niche' },
  { key: 'country', label: 'Country' },
  { key: 'project', label: 'Project' },
  { key: 'gmailLabel', label: 'Gmail label' },
  { key: 'whatsappNumber', label: 'WhatsApp number' },
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
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // The Gmail label auto-fills from the other inputs until the user edits it.
  const [labelEdited, setLabelEdited] = useState(false);
  const create = useCreateCampaign();

  // Existing org niches power the pick-or-create datalist (the user can choose one
  // or type a brand-new name; the API find-or-creates by slugify(name)).
  const niches = useNiches(open);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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
    if (!form.region) missing.push({ key: 'region', label: 'Region' });
    if (missing.length > 0) {
      toast.error(`Fill in: ${missing.map((m) => m.label).join(', ')}.`);
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
            ? `Saved as draft (${c.project}) — the AIM webhook isn't configured yet.`
            : `Locked & loaded — campaign launched (${c.project}).`,
        );
        setOpen(false);
        reset();
      },
      onError: (error) => toast.error(error.message ?? 'Launch failed.'),
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
          {/* Name (optional) */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-name`}>
              Name
              <span className="text-muted-foreground"> (optional)</span>
            </Label>
            <Input
              id={`${fieldId}-name`}
              value={form.name}
              placeholder="Name this attack (optional)"
              maxLength={60}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Niche — pick an existing one or type a new name (API find-or-creates) */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-niche`}>Niche</Label>
            <Input
              id={`${fieldId}-niche`}
              list={`${fieldId}-niche-options`}
              value={form.nicheName}
              placeholder="LED"
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('nicheName', e.target.value)}
            />
            <datalist id={`${fieldId}-niche-options`}>
              {(niches.data ?? []).map((n) => (
                <option key={n.id} value={n.name} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              {nicheIsNew
                ? 'New niche — it’ll be created for your org on launch.'
                : 'Pick an existing niche or type a new name.'}
            </p>
          </div>

          {/* Country */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-country`}>Country</Label>
            <Input
              id={`${fieldId}-country`}
              value={form.country}
              placeholder="Germany"
              maxLength={120}
              onChange={(e) => set('country', e.target.value)}
            />
          </div>

          {/* Region — free text (was "State / City"); the Lead Satellite expands
              it into per-city searches, e.g. "Warszawa, Kraków" or "Mazowieckie" */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-region`}>Region</Label>
            <Input
              id={`${fieldId}-region`}
              value={form.region}
              placeholder="Warszawa, Kraków"
              maxLength={120}
              onChange={(e) => set('region', e.target.value)}
            />
          </div>

          {/* Project */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-project`}>Project</Label>
            <Input
              id={`${fieldId}-project`}
              value={form.project}
              placeholder="LED Retrofit Berlin 2026"
              maxLength={200}
              onChange={(e) => set('project', e.target.value)}
            />
          </div>

          {/* Gmail label — auto-derived until edited */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-gmailLabel`}>Gmail label</Label>
            <Input
              id={`${fieldId}-gmailLabel`}
              value={form.gmailLabel}
              placeholder="LED-Berlin-2026"
              maxLength={120}
              onChange={(e) => {
                setLabelEdited(true);
                set('gmailLabel', e.target.value);
              }}
            />
            {!labelEdited ? (
              <p className="text-xs text-muted-foreground">
                Auto-generated from niche · country · zone · year — edit to
                override.
              </p>
            ) : null}
          </div>

          {/* WhatsApp number */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-whatsappNumber`}>WhatsApp number</Label>
            <Input
              id={`${fieldId}-whatsappNumber`}
              value={form.whatsappNumber}
              placeholder="+49…"
              maxLength={40}
              onChange={(e) => set('whatsappNumber', e.target.value)}
            />
          </div>

          {/* Sender alias — which Gmail identity BAZOOKA sends from */}
          <div className="grid gap-2">
            <Label htmlFor={`${fieldId}-sender`}>Sender alias</Label>
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
            <p className="text-xs text-muted-foreground">
              Gmail alias used as the From identity.
            </p>
          </div>
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

'use client';

// Render on demand, never prerendered: the org's settings are fetched in the
// browser (TanStack Query). General settings are open to any user with
// campaigns:read; the component shows its own loading skeleton off useOrgSettings().
// GrowthShell chrome comes from the (growth) route-group layout.
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { UpdateOrgSettingsDto } from '@evertrust/shared';
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/use-settings';
import { GrowthCard } from '@/modules/(growth)/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

// Shared eyebrow label — uppercase, tracked, muted. Matches the GrowthShell idiom.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </span>
  );
}

// The boolean fields surfaced as toggles (Integrations + Engine Mode cards).
type ToggleField =
  | 'gmailEnabled'
  | 'calendarEnabled'
  | 'readAiEnabled'
  | 'sheetsEnabled'
  | 'approvalBeforeSending'
  | 'autoSend'
  | 'weeklyReportEnabled';

// A labelled Switch row: title + subtitle on the left, the toggle on the right.
function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

// Growth-Engine settings: sender identity, sending parameters, integration +
// engine-mode toggles. Loads via useOrgSettings(); switches PATCH on flip, text /
// number inputs PATCH on blur when their value changed. Local state is seeded from
// the query so typing stays smooth, re-seeded whenever the cache changes.
export function GeneralSettings() {
  const t = useTranslations('settings');
  const settings = useOrgSettings();
  const update = useUpdateOrgSettings();
  const data = settings.data;

  // Local, smooth-typing copies of the text/number fields. Booleans read straight
  // from the query (they only change via an immediate PATCH, never local typing).
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [signature, setSignature] = useState('');
  const [dailySendCap, setDailySendCap] = useState('');
  const [sendingHoursStart, setSendingHoursStart] = useState('');
  const [sendingHoursEnd, setSendingHoursEnd] = useState('');
  const [followupRound2Days, setFollowupRound2Days] = useState('');
  const [followupRound3Days, setFollowupRound3Days] = useState('');

  // Re-seed the form whenever the query data changes (initial load + after a save,
  // since the PATCH response is written back into the cache).
  useEffect(() => {
    if (!data) return;
    setSenderName(data.senderName ?? '');
    setSenderEmail(data.senderEmail ?? '');
    setSignature(data.signature ?? '');
    setDailySendCap(String(data.dailySendCap));
    setSendingHoursStart(data.sendingHoursStart);
    setSendingHoursEnd(data.sendingHoursEnd);
    setFollowupRound2Days(String(data.followupRound2Days));
    setFollowupRound3Days(String(data.followupRound3Days));
  }, [data]);

  // Fire a one-field PATCH and toast the result. Returns nothing — callers ignore.
  function patch(field: UpdateOrgSettingsDto) {
    update.mutate(field, {
      onSuccess: () => toast.success(t('system.toastSaved')),
      onError: (err) => toast.error(err.message || t('system.toastError')),
    });
  }

  // A toggle flip: PATCH just that one boolean immediately.
  function handleToggle(field: ToggleField, next: boolean) {
    patch({ [field]: next });
  }

  // A nullable-text blur (senderName / senderEmail / signature): trim, send null
  // when emptied, and only PATCH when the value actually changed.
  function commitNullableText(
    field: 'senderName' | 'senderEmail' | 'signature',
    raw: string,
  ) {
    if (!data) return;
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === data[field]) return;
    patch({ [field]: next });
  }

  // A number blur: parse, ignore an unparseable/empty entry (re-seed from data),
  // and only PATCH when the integer value changed.
  function commitNumber(
    field:
      | 'dailySendCap'
      | 'followupRound2Days'
      | 'followupRound3Days',
    raw: string,
    reseed: (value: string) => void,
  ) {
    if (!data) return;
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isNaN(n)) {
      reseed(String(data[field]));
      return;
    }
    if (n === data[field]) return;
    patch({ [field]: n });
  }

  // An HH:MM time blur: only PATCH when it changed and matches the HH:MM shape;
  // otherwise re-seed from data so an invalid entry doesn't stick in the field.
  function commitTime(
    field: 'sendingHoursStart' | 'sendingHoursEnd',
    raw: string,
    reseed: (value: string) => void,
  ) {
    if (!data) return;
    const trimmed = raw.trim();
    if (trimmed === data[field]) return;
    if (!/^\d{2}:\d{2}$/.test(trimmed)) {
      reseed(data[field]);
      return;
    }
    patch({ [field]: trimmed });
  }

  if (settings.isLoading || !data) {
    return (
      <main className="px-6 py-5 duration-300 animate-in fade-in">
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-[10px]" />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Card — Sender Identity */}
        <GrowthCard title={t('system.sender.title')}>
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted-foreground">
              {t('system.sender.description')}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sender-name">
                <Eyebrow>{t('system.sender.nameLabel')}</Eyebrow>
              </Label>
              <Input
                id="sender-name"
                autoComplete="off"
                placeholder={t('system.sender.namePlaceholder')}
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                onBlur={() => commitNullableText('senderName', senderName)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sender-email">
                <Eyebrow>{t('system.sender.emailLabel')}</Eyebrow>
              </Label>
              <Input
                id="sender-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('system.sender.emailPlaceholder')}
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                onBlur={() => commitNullableText('senderEmail', senderEmail)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sender-signature">
                <Eyebrow>{t('system.sender.signatureLabel')}</Eyebrow>
              </Label>
              <Textarea
                id="sender-signature"
                rows={3}
                placeholder={t('system.sender.signaturePlaceholder')}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                onBlur={() => commitNullableText('signature', signature)}
              />
            </div>
          </div>
        </GrowthCard>

        {/* Card — Sending Parameters */}
        <GrowthCard title={t('system.sending.title')}>
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted-foreground">
              {t('system.sending.description')}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="daily-cap">
                <Eyebrow>{t('system.sending.dailyCapLabel')}</Eyebrow>
              </Label>
              <Input
                id="daily-cap"
                type="number"
                min={1}
                max={100000}
                inputMode="numeric"
                autoComplete="off"
                value={dailySendCap}
                onChange={(e) => setDailySendCap(e.target.value)}
                onBlur={() =>
                  commitNumber('dailySendCap', dailySendCap, setDailySendCap)
                }
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="hours-start">
                  <Eyebrow>{t('system.sending.hoursStartLabel')}</Eyebrow>
                </Label>
                <Input
                  id="hours-start"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="09:00"
                  value={sendingHoursStart}
                  onChange={(e) => setSendingHoursStart(e.target.value)}
                  onBlur={() =>
                    commitTime(
                      'sendingHoursStart',
                      sendingHoursStart,
                      setSendingHoursStart,
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="hours-end">
                  <Eyebrow>{t('system.sending.hoursEndLabel')}</Eyebrow>
                </Label>
                <Input
                  id="hours-end"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="17:00"
                  value={sendingHoursEnd}
                  onChange={(e) => setSendingHoursEnd(e.target.value)}
                  onBlur={() =>
                    commitTime(
                      'sendingHoursEnd',
                      sendingHoursEnd,
                      setSendingHoursEnd,
                    )
                  }
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="round2">
                  <Eyebrow>{t('system.sending.round2Label')}</Eyebrow>
                </Label>
                <Input
                  id="round2"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  autoComplete="off"
                  value={followupRound2Days}
                  onChange={(e) => setFollowupRound2Days(e.target.value)}
                  onBlur={() =>
                    commitNumber(
                      'followupRound2Days',
                      followupRound2Days,
                      setFollowupRound2Days,
                    )
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="round3">
                  <Eyebrow>{t('system.sending.round3Label')}</Eyebrow>
                </Label>
                <Input
                  id="round3"
                  type="number"
                  min={0}
                  max={365}
                  inputMode="numeric"
                  autoComplete="off"
                  value={followupRound3Days}
                  onChange={(e) => setFollowupRound3Days(e.target.value)}
                  onBlur={() =>
                    commitNumber(
                      'followupRound3Days',
                      followupRound3Days,
                      setFollowupRound3Days,
                    )
                  }
                />
              </div>
            </div>
          </div>
        </GrowthCard>

        {/* Card — Integrations */}
        <GrowthCard title={t('system.integrations.title')}>
          <div className="flex flex-col gap-5">
            <ToggleRow
              id="gmail-enabled"
              label={t('system.integrations.gmailLabel')}
              hint={t('system.integrations.gmailHint')}
              checked={data.gmailEnabled}
              onCheckedChange={(next) => handleToggle('gmailEnabled', next)}
            />
            <ToggleRow
              id="calendar-enabled"
              label={t('system.integrations.calendarLabel')}
              hint={t('system.integrations.calendarHint')}
              checked={data.calendarEnabled}
              onCheckedChange={(next) => handleToggle('calendarEnabled', next)}
            />
            <ToggleRow
              id="read-ai-enabled"
              label={t('system.integrations.readAiLabel')}
              hint={t('system.integrations.readAiHint')}
              checked={data.readAiEnabled}
              onCheckedChange={(next) => handleToggle('readAiEnabled', next)}
            />
            <ToggleRow
              id="sheets-enabled"
              label={t('system.integrations.sheetsLabel')}
              hint={t('system.integrations.sheetsHint')}
              checked={data.sheetsEnabled}
              onCheckedChange={(next) => handleToggle('sheetsEnabled', next)}
            />
          </div>
        </GrowthCard>

        {/* Card — Engine Mode */}
        <GrowthCard title={t('system.engine.title')}>
          <div className="flex flex-col gap-5">
            <ToggleRow
              id="approval-before-sending"
              label={t('system.engine.approvalLabel')}
              hint={t('system.engine.approvalHint')}
              checked={data.approvalBeforeSending}
              onCheckedChange={(next) =>
                handleToggle('approvalBeforeSending', next)
              }
            />
            <ToggleRow
              id="auto-send"
              label={t('system.engine.autoSendLabel')}
              hint={t('system.engine.autoSendHint')}
              checked={data.autoSend}
              onCheckedChange={(next) => handleToggle('autoSend', next)}
            />
            <ToggleRow
              id="weekly-report"
              label={t('system.engine.weeklyReportLabel')}
              hint={t('system.engine.weeklyReportHint')}
              checked={data.weeklyReportEnabled}
              onCheckedChange={(next) =>
                handleToggle('weeklyReportEnabled', next)
              }
            />
          </div>
        </GrowthCard>
      </div>
    </main>
  );
}

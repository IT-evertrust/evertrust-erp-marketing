'use client';

// Render on demand, never prerendered: the org's settings are fetched in the
// browser (TanStack Query). General settings are open to any user with
// campaigns:read; the component shows its own loading skeleton off useOrgSettings().
// GrowthShell chrome comes from the (growth) route-group layout.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type {
  ConnectedGoogleAccountDto,
  UpdateOrgSettingsDto,
} from '@evertrust/shared';
import { useOrgSettings, useUpdateOrgSettings } from '@/hooks/use-settings';
import {
  useDisconnectGoogleAccount,
  useGoogleAccounts,
} from '@/hooks/use-arsenal';
import {
  useClearMySignatureImage,
  useMe,
  useSetMySignatureImageUrl,
  useUpdateMySenderIdentity,
  useUploadMySignatureImage,
} from '@/hooks/use-auth';
import { ApiError, api } from '@/lib/api';
import { GrowthCard } from '@/modules/(growth)/shared';
import { Button } from '@/components/ui/button';
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

// Connected Google accounts — moved here from the (removed) Configuration page so
// account management lives in one Settings surface. Lists every Google account
// connected to the org (Gmail/Calendar), lets an admin connect another, and remove
// one. Removing an account revokes its Google grant, deletes the connection, and
// (server-side) invalidates that user's session so they must sign in again.
function ConnectedAccountsCard() {
  const router = useRouter();
  const accounts = useGoogleAccounts();
  const disconnect = useDisconnectGoogleAccount();

  const [connectConfigured, setConnectConfigured] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const list = accounts.data ?? [];

  // On return from Google's consent screen the callback appends
  // ?google=connected|error. Toast once, refetch, then strip the param so a refresh
  // doesn't re-toast. Runs once on mount.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get('google');
    if (param !== 'connected' && param !== 'error') return;
    if (param === 'connected') {
      toast.success('Google account connected.');
      void accounts.refetch();
    } else {
      toast.error('Could not connect that Google account.');
    }
    router.replace('/settings/general');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await api.google.start();
      window.location.href = res.url;
    } catch (err) {
      setConnecting(false);
      if (err instanceof ApiError && err.status === 503) {
        setConnectConfigured(false);
        return;
      }
      toast.error(
        err instanceof Error ? err.message : 'Could not start Google connect.',
      );
    }
  }

  function handleRemove(a: ConnectedGoogleAccountDto) {
    if (
      !window.confirm(
        `Remove ${a.email}? This signs that user out and they'll need to log in again to use the system.`,
      )
    ) {
      return;
    }
    setPendingId(a.id);
    disconnect.mutate(a.id, {
      onSuccess: () => toast.success(`${a.email} removed.`),
      onError: (err) => toast.error(err.message || 'Could not remove account.'),
      onSettled: () => setPendingId(null),
    });
  }

  const statusLabel: Record<ConnectedGoogleAccountDto['status'], string> = {
    CONNECTED: 'Connected',
    REVOKED: 'Revoked',
    ERROR: 'Error',
  };

  return (
    <GrowthCard
      title="Connected accounts"
      className="lg:col-span-2"
      hint={
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleConnect}
            disabled={connecting || !connectConfigured}
          >
            {connecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            {connecting ? 'Connecting…' : 'Connect account'}
          </Button>
          {!connectConfigured ? (
            <p className="text-right text-xs text-muted-foreground">
              Google connect isn&apos;t configured on the server.
            </p>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Every Google account connected to this workspace. Removing one revokes its
          access and signs that person out — they&apos;ll need to log in again.
        </p>

        {accounts.isLoading ? (
          <Skeleton className="h-24 w-full rounded-[10px]" />
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Google accounts are connected yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-sidebar-border rounded-[10px] border border-sidebar-border">
            {list.map((a) => {
              const rowBusy = disconnect.isPending && pendingId === a.id;
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: a.color ?? '#9ca3af' }}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {a.email}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {statusLabel[a.status]}
                        {a.isDefault ? ' · Default mailbox' : ''}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${a.email}`}
                    title={`Remove ${a.email}`}
                    onClick={() => handleRemove(a)}
                    disabled={disconnect.isPending}
                  >
                    {rowBusy ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="size-4" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GrowthCard>
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

  // PER-USER sender identity. senderName + signature text + signature image belong to
  // the CURRENT user (not the org): they seed from the `me` query and write via the
  // per-user mutations. senderEmail stays ORG (still on useOrgSettings). The signature
  // image (users.signatureImageUrl) — separate from the signature TEXT — is embedded at
  // the bottom of that user's outgoing Reach/Engage mail. Held in local state: seeded
  // from `me`, then updated from each upload/clear mutation result.
  const me = useMe();
  const myIdentity = me.data;
  const updateSenderIdentity = useUpdateMySenderIdentity();
  const uploadSignatureImage = useUploadMySignatureImage();
  const setSignatureImageLink = useSetMySignatureImageUrl();
  const clearSignatureImage = useClearMySignatureImage();
  const [signatureImageUrl, setSignatureImageUrl] = useState<string | null>(null);
  const [signatureLinkInput, setSignatureLinkInput] = useState('');
  const signatureFileRef = useRef<HTMLInputElement>(null);

  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [signature, setSignature] = useState('');
  const [dailySendCap, setDailySendCap] = useState('');
  const [sendingHoursStart, setSendingHoursStart] = useState('');
  const [sendingHoursEnd, setSendingHoursEnd] = useState('');
  const [followupRound2Days, setFollowupRound2Days] = useState('');
  const [followupRound3Days, setFollowupRound3Days] = useState('');

  // Re-seed the PER-USER identity fields whenever the `me` query changes (initial load
  // + after a save, since the mutations write the fresh user back into the cache).
  useEffect(() => {
    if (!myIdentity) return;
    setSenderName(myIdentity.senderName ?? '');
    setSignature(myIdentity.signature ?? '');
    setSignatureImageUrl(myIdentity.signatureImageUrl ?? null);
  }, [myIdentity]);

  // Re-seed the ORG fields whenever the org-settings query changes (initial load + after
  // a save, since the PATCH response is written back into the cache).
  useEffect(() => {
    if (!data) return;
    setSenderEmail(data.senderEmail ?? '');
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

  // The ORG senderEmail blur: trim, send null when emptied, and only PATCH when the
  // value actually changed. (senderName + signature are PER-USER — see below.)
  function commitSenderEmail(raw: string) {
    if (!data) return;
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (data.senderEmail ?? null)) return;
    patch({ senderEmail: next });
  }

  // A PER-USER nullable-text blur (senderName / signature): trim, send null when
  // emptied, and only PATCH when the value actually changed against the current user.
  function commitMyIdentity(field: 'senderName' | 'signature', raw: string) {
    if (!myIdentity) return;
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : trimmed;
    if (next === (myIdentity[field] ?? null)) return;
    updateSenderIdentity.mutate(
      { [field]: next },
      {
        onSuccess: () => toast.success(t('system.toastSaved')),
        onError: (err) => toast.error(err.message || t('system.toastError')),
      },
    );
  }

  // Signature image: upload a picked file (multipart), or clear the current one.
  function handleSignatureImageUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file
    if (!file) return;
    uploadSignatureImage.mutate(file, {
      onSuccess: (res) => {
        setSignatureImageUrl(res.signatureImageUrl ?? null);
        toast.success(t('system.toastSaved'));
      },
      onError: (err) => toast.error(err.message || t('system.toastError')),
    });
  }

  function handleSignatureImageClear() {
    clearSignatureImage.mutate(undefined, {
      onSuccess: (res) => {
        setSignatureImageUrl(res.signatureImageUrl ?? null);
        setSignatureLinkInput('');
        toast.success(t('system.toastSaved'));
      },
      onError: (err) => toast.error(err.message || t('system.toastError')),
    });
  }

  // Signature image via link: point the image at a pasted URL (a Drive share link
  // is normalized server-side, any other image URL is stored as-is). No-op on an
  // empty input.
  function handleSignatureImageLink() {
    const url = signatureLinkInput.trim();
    if (!url) return;
    setSignatureImageLink.mutate(url, {
      onSuccess: (res) => {
        setSignatureImageUrl(res.signatureImageUrl ?? null);
        setSignatureLinkInput('');
        toast.success(t('system.toastSaved'));
      },
      onError: (err) => toast.error(err.message || t('system.toastError')),
    });
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
                onBlur={() => commitMyIdentity('senderName', senderName)}
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
                onBlur={() => commitSenderEmail(senderEmail)}
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
                onBlur={() => commitMyIdentity('signature', signature)}
              />
            </div>

            {/* Signature image — uploaded picture embedded at the bottom of
                outgoing mail. Separate from the signature text above. */}
            <div className="flex flex-col gap-2">
              <Label>
                <Eyebrow>{t('system.sender.signatureImageLabel')}</Eyebrow>
              </Label>
              {signatureImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signatureImageUrl}
                  alt={t('system.sender.signatureImageAlt')}
                  className="max-h-20 max-w-[240px] rounded-md border border-border bg-white object-contain p-1"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t('system.sender.signatureImageEmpty')}
                </p>
              )}
              <input
                ref={signatureFileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={handleSignatureImageUpload}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadSignatureImage.isPending}
                  onClick={() => signatureFileRef.current?.click()}
                >
                  {uploadSignatureImage.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t('system.sender.signatureImageUpload')}
                </Button>
                {signatureImageUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={clearSignatureImage.isPending}
                    onClick={handleSignatureImageClear}
                  >
                    {t('system.sender.signatureImageRemove')}
                  </Button>
                ) : null}
              </div>
              {/* …or point it at an image URL / Drive share link instead of a
                  file upload. The link is normalized + stored server-side. */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="url"
                  inputMode="url"
                  value={signatureLinkInput}
                  placeholder={t('system.sender.signatureImageUrlPlaceholder')}
                  className="h-8 w-full max-w-[320px] text-xs sm:flex-1"
                  disabled={setSignatureImageLink.isPending}
                  onChange={(e) => setSignatureLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSignatureImageLink();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    setSignatureImageLink.isPending ||
                    signatureLinkInput.trim().length === 0
                  }
                  onClick={handleSignatureImageLink}
                >
                  {setSignatureImageLink.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  {t('system.sender.signatureImageUrlButton')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('system.sender.signatureImageHint')}
              </p>
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

        {/* Card — Connected accounts (was the separate Configuration page). */}
        <ConnectedAccountsCard />
      </div>
    </main>
  );
}

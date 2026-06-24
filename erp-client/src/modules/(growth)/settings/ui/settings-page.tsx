'use client';

import { useEffect, useState } from 'react';

import { GrowthCard, Spinner } from '@/modules/(growth)/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useReachSettings } from '../hooks/use-reach-settings';
import type { ReachSendMode } from '../services/settings.service';

// Shared eyebrow label — uppercase, tracked, muted. Matches the GrowthShell idiom
// used across the settings cards.
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </span>
  );
}

// The Reach Send Policy + a one-off test-send form. Reads the org's per-org policy
// (mode / test recipient / daily cap) and the connected sending mailbox, lets an
// admin edit + save the policy, and fires a test email. Theme tokens only.
export function GrowthSettingsPage() {
  const { settings, loading, saving, testing, testResult, save, sendTest } =
    useReachSettings();

  // Local form state, seeded from the loaded settings. '' cap clears the override.
  const [mode, setMode] = useState<ReachSendMode>('test');
  const [testRecipient, setTestRecipient] = useState('');
  const [cap, setCap] = useState('');

  // The test-send form's own email field (independent of the saved recipient).
  const [testTo, setTestTo] = useState('');

  // Seed the form whenever fresh settings land (initial load + after a save).
  useEffect(() => {
    if (!settings) return;
    setMode(settings.mode);
    setTestRecipient(settings.testRecipient);
    setCap(String(settings.cap));
    setTestTo((current) => current || settings.testRecipient);
  }, [settings]);

  function handleSave() {
    const trimmedCap = cap.trim();
    const parsedCap = trimmedCap === '' ? null : Number.parseInt(trimmedCap, 10);
    save({
      mode,
      // '' clears the test recipient override → the env default.
      testRecipient: testRecipient.trim() === '' ? null : testRecipient.trim(),
      // '' or unparseable clears the cap override → the env default.
      cap: parsedCap === null || Number.isNaN(parsedCap) ? null : parsedCap,
    });
  }

  function handleSendTest() {
    const to = testTo.trim();
    if (!to) return;
    void sendTest(to);
  }

  const env = settings?.envDefaults;
  const mailbox = settings?.mailbox;

  return (
    <main className="px-6 py-5 duration-300 animate-in fade-in">
      <div className="mb-4">
        <h1 className="text-[18px] font-bold leading-tight text-foreground">
          Reach Send Policy
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Controls how the Reach sender delivers email for this org — test vs live
          mode, the test inbox, and the daily send cap.
        </p>
      </div>

      <div className="columns-1 gap-4 xl:columns-2 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {/* Card 1 — the editable send policy + mailbox status. */}
        <GrowthCard title="Send policy">
          {loading || !settings ? (
            <Spinner label="Loading send policy…" />
          ) : (
            <div className="flex flex-col gap-6">
              {/* Send mode — segmented test/live toggle. */}
              <div className="flex flex-col gap-1.5">
                <Eyebrow>Send mode</Eyebrow>
                <div
                  role="group"
                  aria-label="Send mode"
                  className="inline-flex w-fit rounded-[10px] border border-sidebar-border bg-muted/40 p-0.5"
                >
                  {(['test', 'live'] as const).map((value) => {
                    const active = mode === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setMode(value)}
                        className={[
                          'rounded-[8px] px-3 py-1.5 text-xs font-semibold capitalize transition-colors',
                          active
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        ].join(' ')}
                      >
                        {value}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  In test mode outbound is routed to the test recipient, never
                  delivered to prospects. Env default:{' '}
                  <span className="font-semibold text-foreground capitalize">
                    {env?.mode}
                  </span>
                  .
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Test recipient. */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reach-test-recipient">
                    <Eyebrow>Test recipient</Eyebrow>
                  </Label>
                  <Input
                    id="reach-test-recipient"
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={env?.testRecipient || 'qa@your-org.com'}
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Where test-mode sends are routed. Blank falls back to{' '}
                    <span className="font-semibold text-foreground">
                      {env?.testRecipient || '—'}
                    </span>
                    .
                  </p>
                </div>

                {/* Daily send cap. */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reach-cap">
                    <Eyebrow>Daily send cap</Eyebrow>
                  </Label>
                  <Input
                    id="reach-cap"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={env ? String(env.cap) : '200'}
                    value={cap}
                    onChange={(e) => setCap(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Max outbound emails per day. Blank falls back to{' '}
                    <span className="font-semibold text-foreground">
                      {env?.cap ?? '—'}
                    </span>
                    .
                  </p>
                </div>
              </div>

              {/* Mailbox status — connected (email) or the reason it isn&apos;t. */}
              <div className="flex flex-col gap-1.5 border-t border-sidebar-border pt-4">
                <Eyebrow>Sending mailbox</Eyebrow>
                {mailbox?.connected ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="default">Connected</Badge>
                    <span className="text-sm font-semibold text-foreground">
                      {mailbox.email ?? '—'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    <Badge variant="outline" className="w-fit">
                      Not connected
                    </Badge>
                    <p className="text-xs text-muted-foreground">
                      {mailbox?.reason ??
                        'No sending mailbox is connected for this org.'}
                    </p>
                  </div>
                )}
              </div>

              <Button
                type="button"
                className="self-start"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Spinner inline size={14} />
                ) : null}
                {saving ? 'Saving…' : 'Save send policy'}
              </Button>
            </div>
          )}
        </GrowthCard>

        {/* Card 2 — send a one-off test email. */}
        <GrowthCard title="Send test email">
          <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
              Fire a single test email from the org&apos;s sending mailbox to verify
              delivery.
            </p>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reach-test-to">
                <Eyebrow>Recipient</Eyebrow>
              </Label>
              <div className="flex flex-wrap items-end gap-2">
                <Input
                  id="reach-test-to"
                  type="email"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="you@your-org.com"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  className="min-w-[12rem] flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendTest}
                  disabled={testing || testTo.trim() === ''}
                >
                  {testing ? <Spinner inline size={14} /> : null}
                  {testing ? 'Sending…' : 'Send test'}
                </Button>
              </div>
            </div>

            {/* The ok/reason result of the last test send. */}
            {testResult ? (
              <div
                className={[
                  'flex flex-col gap-1 rounded-[10px] border p-3 text-xs',
                  testResult.ok
                    ? 'border-sidebar-border bg-muted/40'
                    : 'border-destructive/40 bg-destructive/10',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <Badge variant={testResult.ok ? 'default' : 'destructive'}>
                    {testResult.ok ? 'Sent' : 'Failed'}
                  </Badge>
                  <span className="font-semibold text-foreground">
                    {testResult.to}
                  </span>
                </div>
                {testResult.ok ? (
                  <p className="text-muted-foreground">
                    From {testResult.from ?? '—'}
                    {testResult.messageId
                      ? ` · id ${testResult.messageId}`
                      : null}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {testResult.reason ?? 'Test send failed.'}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </GrowthCard>
      </div>
    </main>
  );
}

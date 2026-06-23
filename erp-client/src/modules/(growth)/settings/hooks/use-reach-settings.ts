'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  getReachSettings,
  sendReachTestEmail,
  updateReachSettings,
} from '../services/settings.service';
import type { ReachSettings, TestSendResult } from '../types';

export function useReachSettings() {
  const [settings, setSettings] = useState<ReachSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable form state (seeded from the loaded settings).
  const [testMode, setTestMode] = useState(true);
  const [testRecipient, setTestRecipient] = useState('');
  const [cap, setCap] = useState(3);

  // Test-send box state.
  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState<TestSendResult | null>(null);

  const seed = (s: ReachSettings) => {
    setTestMode(s.mode === 'test');
    setTestRecipient(s.testRecipient);
    setCap(s.cap);
    // Default the test-send recipient to the configured test inbox.
    setTestTo((prev) => prev || s.testRecipient);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    getReachSettings()
      .then((s) => {
        if (!active) return;
        setSettings(s);
        seed(s);
      })
      .catch(() => {
        if (active) toast.error('Could not load send settings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const dirty =
    !!settings &&
    (testMode !== (settings.mode === 'test') ||
      testRecipient.trim() !== settings.testRecipient ||
      cap !== settings.cap);

  const save = async () => {
    setSaving(true);
    try {
      const next = await updateReachSettings({
        mode: testMode ? 'test' : 'live',
        testRecipient: testRecipient.trim() || null,
        cap: Number.isFinite(cap) && cap > 0 ? cap : null,
      });
      setSettings(next);
      seed(next);
      toast.success(
        testMode
          ? 'Test mode ON — Reach emails are redirected to the test inbox.'
          : 'Test mode OFF — Reach now sends to real recipients.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    const to = testTo.trim();
    if (!to) {
      toast.error('Enter an inbox to send the test to.');
      return;
    }
    setSending(true);
    setLastSend(null);
    try {
      const result = await sendReachTestEmail(to);
      setLastSend(result);
      if (result.ok) toast.success(`Test email sent to ${result.to}.`);
      else toast.error(result.reason ?? 'Test send failed.');
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Test send failed.';
      setLastSend({ ok: false, to, from: null, messageId: null, reason });
      toast.error(reason);
    } finally {
      setSending(false);
    }
  };

  return {
    settings,
    loading,
    saving,
    dirty,
    // send-policy form
    testMode,
    setTestMode,
    testRecipient,
    setTestRecipient,
    cap,
    setCap,
    save,
    // test-send box
    testTo,
    setTestTo,
    sending,
    lastSend,
    sendTest,
  };
}

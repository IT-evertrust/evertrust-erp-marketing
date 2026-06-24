'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  getReachSettings,
  sendReachTestEmail,
  updateReachSettings,
  type ReachSettings,
  type ReachSettingsPatch,
  type ReachTestSendResult,
} from '../services/settings.service';

// Drives the Reach Send Policy card: loads the org settings once, then exposes a
// PATCH save + a one-off test send. Mirrors the reach module's hook style
// (local useState/useEffect + sonner toasts), so it stays consistent with the
// rest of the growth app rather than introducing a second data pattern.
export function useReachSettings() {
  const [settings, setSettings] = useState<ReachSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ReachTestSendResult | null>(null);

  // Load the settings once.
  useEffect(() => {
    let ignore = false;
    getReachSettings()
      .then((data) => {
        if (!ignore) setSettings(data);
      })
      .catch((err) => {
        if (ignore) return;
        setSettings(null);
        toast.error(err instanceof Error ? err.message : 'Failed to load settings');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  // PATCH the send policy; the server returns the refreshed settings, which we
  // seed back so helper text (env defaults, mailbox) stays in sync. Returns the
  // updated settings on success, or null on failure.
  async function save(patch: ReachSettingsPatch): Promise<ReachSettings | null> {
    setSaving(true);
    try {
      const updated = await updateReachSettings(patch);
      setSettings(updated);
      toast.success('Send policy saved');
      return updated;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings');
      return null;
    } finally {
      setSaving(false);
    }
  }

  // Fire a one-off test email and surface the ok/reason result inline.
  async function sendTest(to: string): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await sendReachTestEmail(to);
      setTestResult(result);
      if (result.ok) toast.success(`Test email sent to ${result.to}`);
      else toast.error(result.reason ?? 'Test send failed');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Test send failed';
      setTestResult({ ok: false, to, from: null, messageId: null, reason: message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  }

  return {
    settings,
    loading,
    saving,
    testing,
    testResult,
    save,
    sendTest,
  };
}

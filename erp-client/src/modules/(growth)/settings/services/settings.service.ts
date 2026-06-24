import { API_URL } from '@/lib/env';

// ---- backend shapes (erp-server /growth/reach/settings) ----
export type ReachSendMode = 'test' | 'live';

// The org's Reach Send Policy, resolved per-org (org value ?? env default). The
// `envDefaults` mirror what a reset/blank falls back to; `mailbox` is the org's
// connected sending mailbox (or why it's unavailable).
export interface ReachSettings {
  mode: ReachSendMode;
  testRecipient: string;
  cap: number;
  envDefaults: {
    mode: ReachSendMode;
    testRecipient: string;
    cap: number;
  };
  mailbox: {
    connected: boolean;
    email: string | null;
    reason: string | null;
  };
}

// Partial update for the send policy. A null clears the override → the env default.
export interface ReachSettingsPatch {
  mode?: ReachSendMode;
  testRecipient?: string | null;
  cap?: number | null;
}

// The result of a one-off test send: ok + where it went, the resolved from
// address, the provider message id, and (on failure) the reason.
export interface ReachTestSendResult {
  ok: boolean;
  to: string;
  from: string | null;
  messageId: string | null;
  reason: string | null;
}

// Mirrors the reach module's fetch/error idiom (credentials:'include', JSON, and
// a server-message-aware error) so the two services behave identically.
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

async function mutate<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${method} ${path} -> ${res.status}`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json?.message) {
        message = Array.isArray(json.message)
          ? json.message.join(', ')
          : json.message;
      }
    } catch {
      // non-JSON error body — keep the status-based message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

// ---- API ----
export function getReachSettings(): Promise<ReachSettings> {
  return getJson<ReachSettings>('/growth/reach/settings');
}

// Patch the send policy; returns the refreshed settings (same shape as GET).
export function updateReachSettings(
  patch: ReachSettingsPatch,
): Promise<ReachSettings> {
  return mutate<ReachSettings>('PATCH', '/growth/reach/settings', patch);
}

// Fire a one-off test email to `to` from the org's sending mailbox.
export function sendReachTestEmail(to: string): Promise<ReachTestSendResult> {
  return mutate<ReachTestSendResult>('POST', '/growth/reach/settings/test-send', {
    to,
  });
}

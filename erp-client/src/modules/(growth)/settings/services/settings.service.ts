import { API_URL } from '@/lib/env';

import type { ReachSettings, TestSendResult } from '../types';

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

// The org's effective Reach send policy + env defaults + mailbox status.
export async function getReachSettings(): Promise<ReachSettings> {
  return getJson<ReachSettings>('/growth/reach/settings');
}

// Persist the send policy; returns the refreshed effective settings.
export async function updateReachSettings(patch: {
  mode?: 'test' | 'live';
  testRecipient?: string | null;
  cap?: number | null;
}): Promise<ReachSettings> {
  return mutate<ReachSettings>('PATCH', '/growth/reach/settings', patch);
}

// Send a one-off sample email to `to` via the org's connected mailbox.
export async function sendReachTestEmail(to: string): Promise<TestSendResult> {
  return mutate<TestSendResult>('POST', '/growth/reach/settings/test-send', {
    to,
  });
}

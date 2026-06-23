// The Reach send-policy settings as returned by GET /growth/reach/settings — the
// EFFECTIVE values (per-org override ?? env default), the env defaults (shown as the
// "reset" baseline), and the current sending-mailbox status.
export type ReachSettings = {
  mode: 'test' | 'live';
  testRecipient: string;
  cap: number;
  envDefaults: {
    mode: 'test' | 'live';
    testRecipient: string;
    cap: number;
  };
  mailbox: {
    connected: boolean;
    email: string | null;
    reason: string | null;
  };
};

// Result of POST /growth/reach/settings/test-send.
export type TestSendResult = {
  ok: boolean;
  to: string;
  from: string | null;
  messageId: string | null;
  reason: string | null;
};

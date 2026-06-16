import { TokenCrypto } from '../src/google/token-crypto';
import type { AppConfigService } from '../src/config/app-config.service';

// TokenCrypto encrypts the Google OAuth refresh/access tokens at rest (AES-256-GCM).
// Contract under test: (1) encrypt → decrypt round-trips to the original plaintext;
// (2) a tampered blob fails the auth-tag check and throws; (3) a wrong-length key
// throws a clear error; (4) isConfigured() reflects whether a valid 32-byte key is set.

// A fixed, valid 32-byte (base64-encoded) key for the configured paths.
const KEY_32 = Buffer.alloc(32, 7).toString('base64');

// Build an AppConfigService whose GOOGLE_TOKEN_ENC_KEY is the given value.
function makeConfig(key: string): AppConfigService {
  const values: Record<string, string> = { GOOGLE_TOKEN_ENC_KEY: key };
  return { get: (k: string) => values[k] ?? '' } as unknown as AppConfigService;
}

describe('TokenCrypto', () => {
  it('round-trips encrypt/decrypt to the original plaintext', () => {
    const crypto = new TokenCrypto(makeConfig(KEY_32));
    const plain = 'ya29.super-secret-refresh-token';
    const blob = crypto.encrypt(plain);

    // The ciphertext is the iv:tag:ct shape and never the plaintext.
    expect(blob).not.toContain(plain);
    expect(blob.split(':')).toHaveLength(3);

    expect(crypto.decrypt(blob)).toBe(plain);
  });

  it('produces a different blob each time (random IV) but both decrypt', () => {
    const crypto = new TokenCrypto(makeConfig(KEY_32));
    const a = crypto.encrypt('same-token');
    const b = crypto.encrypt('same-token');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('same-token');
    expect(crypto.decrypt(b)).toBe('same-token');
  });

  it('throws when the blob has been tampered with', () => {
    const crypto = new TokenCrypto(makeConfig(KEY_32));
    const blob = crypto.encrypt('tamper-me');
    const parts = blob.split(':');
    const iv = parts[0]!;
    const tag = parts[1]!;
    const ct = parts[2]!;

    // Flip the last base64 char of the ciphertext to corrupt it.
    const flipped = ct.slice(0, -1) + (ct.endsWith('A') ? 'B' : 'A');
    const tampered = [iv, tag, flipped].join(':');

    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it('throws on a malformed (non-3-part) blob', () => {
    const crypto = new TokenCrypto(makeConfig(KEY_32));
    expect(() => crypto.decrypt('not-a-valid-blob')).toThrow(
      /Malformed encrypted token blob/,
    );
  });

  it('throws a clear error when the key is the wrong length', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64'); // 128-bit, not 256
    const crypto = new TokenCrypto(makeConfig(shortKey));
    expect(() => crypto.encrypt('x')).toThrow(/must be 32 bytes/);
  });

  it('throws a clear error when the key is missing', () => {
    const crypto = new TokenCrypto(makeConfig(''));
    expect(() => crypto.encrypt('x')).toThrow(/GOOGLE_TOKEN_ENC_KEY is not set/);
  });

  it('isConfigured() reflects whether a valid 32-byte key is present', () => {
    expect(new TokenCrypto(makeConfig(KEY_32)).isConfigured()).toBe(true);
    expect(new TokenCrypto(makeConfig('')).isConfigured()).toBe(false);
    // Wrong length → not configured.
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(new TokenCrypto(makeConfig(shortKey)).isConfigured()).toBe(false);
  });
});

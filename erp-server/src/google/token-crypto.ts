import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

// AES-256-GCM symmetric encryption for the OAuth refresh/access tokens stored in
// google_accounts. Plaintext tokens must NEVER touch the DB — every refresh token
// is encrypted here before it is written, and decrypted only in-memory when a
// token has to be refreshed or revoked.
//
// KEY: the base64-decoded GOOGLE_TOKEN_ENC_KEY, which MUST decode to exactly 32
// bytes (256 bits). A missing or wrong-length key throws a clear error rather than
// silently producing a weak or broken cipher — so a misconfigured deployment fails
// loud the first time it tries to encrypt, not deep inside Google's API.
//
// WIRE FORMAT: base64(iv) ':' base64(authTag) ':' base64(ciphertext). The 12-byte
// random IV (the GCM-recommended length) is generated per encrypt() so the same
// plaintext never produces the same blob; the auth tag makes decrypt() reject any
// tampered ciphertext.
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM-recommended nonce length

@Injectable()
export class TokenCrypto {
  constructor(private readonly config: AppConfigService) {}

  // Decode + validate the configured key. Throws a clear error when the key is
  // missing or not exactly 32 bytes once base64-decoded. Kept private so every
  // crypto op funnels through the same validation.
  private key(): Buffer {
    const raw = this.config.get('GOOGLE_TOKEN_ENC_KEY');
    if (!raw) {
      throw new Error(
        'GOOGLE_TOKEN_ENC_KEY is not set — cannot encrypt/decrypt Google tokens',
      );
    }
    const key = Buffer.from(raw, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `GOOGLE_TOKEN_ENC_KEY must be ${KEY_BYTES} bytes (base64-encoded), got ${key.length}`,
      );
    }
    return key;
  }

  // True when a valid 32-byte key is configured. Lets callers (GoogleOAuthService.
  // isConfigured) gate the whole connect feature without catching exceptions.
  isConfigured(): boolean {
    try {
      this.key();
      return true;
    } catch {
      return false;
    }
  }

  // Encrypt a plaintext token to "iv:tag:ciphertext" (each part base64). A fresh
  // random IV per call keeps the output non-deterministic.
  encrypt(plain: string): string {
    const key = this.key();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plain, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(':');
  }

  // Reverse encrypt(). Throws on a malformed blob or a failed auth-tag check (any
  // tampering with iv/tag/ciphertext makes final() throw), so a corrupted or
  // forged value can never be returned as a valid token.
  decrypt(blob: string): string {
    const parts = blob.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted token blob');
    }
    const key = this.key();
    // Length is exactly 3 (guarded above), so each part is present.
    const iv = Buffer.from(parts[0]!, 'base64');
    const authTag = Buffer.from(parts[1]!, 'base64');
    const ciphertext = Buffer.from(parts[2]!, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString('utf8');
  }
}

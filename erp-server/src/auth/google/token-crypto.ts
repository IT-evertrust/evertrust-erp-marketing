import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

// AES-256-GCM for refresh tokens at rest. The key is the sha256 of GOOGLE_TOKEN_ENC_KEY
// so any non-empty secret works as a key. Payload format: iv.tag.ciphertext (base64).

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    enc.toString('base64'),
  ].join('.');
}

export function decryptToken(payload: string, secret: string): string {
  const [ivB64, tagB64, encB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !encB64) {
    throw new Error('Malformed encrypted token payload');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(secret),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

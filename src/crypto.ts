/**
 * Cryptographic helpers for HMAC authentication and AES-256-GCM credentials encryption.
 */

export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBuf(hex: string): ArrayBuffer {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd character length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

export async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return bufToHex(hashBuffer);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    new TextEncoder().encode(message)
  );
  return bufToHex(sigBuffer);
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) {
    let dummy = 0;
    for (let i = 0; i < aBytes.length; i++) {
      dummy |= aBytes[i] ^ aBytes[i];
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Keys used for provider-credential encryption at rest.
 *
 * `encryptionKey` (ENCRYPTION_KEY) is a server-only secret. `apiSecret` (API_SECRET)
 * is shared with every API client for request signing, so it is only used to read
 * records written before ENCRYPTION_KEY existed (envelope v1 and older).
 */
export interface CredentialKeys {
  encryptionKey?: string;
  apiSecret?: string;
}

export const MIN_ENCRYPTION_KEY_LENGTH = 32;

/** Thrown when server configuration (secrets, settings) is missing or invalid; mapped to 500 server_misconfigured. */
export class ConfigError extends Error {}

export function credentialKeys(env: { ENCRYPTION_KEY?: string; API_SECRET?: string }): CredentialKeys {
  const encryptionKey = env.ENCRYPTION_KEY?.trim() || undefined;
  if (encryptionKey && encryptionKey.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new ConfigError(
      `ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters (generate one with: openssl rand -hex 32)`
    );
  }
  return { encryptionKey, apiSecret: env.API_SECRET || undefined };
}

type KeyVersion = 'v2' | 'v1' | 'legacy';

/**
 * Derive a 256-bit AES-GCM CryptoKey using domain-separated SHA-256.
 *   v2:     from ENCRYPTION_KEY (current)
 *   v1:     from API_SECRET (read-only, pre-ENCRYPTION_KEY records)
 *   legacy: from API_SECRET without domain separation (read-only)
 */
async function getAesGcmKey(secret: string, version: KeyVersion): Promise<CryptoKey> {
  const keyTag =
    version === 'v2' ? `unsent:credentials:aes-256-gcm:v2:${secret}`
    : version === 'v1' ? `unsent:aes-256-gcm:v1:${secret}`
    : secret;
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyTag));
  return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

let warnedMissingEncryptionKey = false;

/**
 * Encrypt provider credentials JSON using AES-256-GCM.
 *
 * With ENCRYPTION_KEY set, writes a v2 envelope. Without it, falls back to the
 * v1 API_SECRET-derived key so existing deployments keep working, and logs a
 * warning, because anyone holding API_SECRET can then decrypt a database dump.
 */
export async function encryptCredentials(
  credentials: Record<string, any> | string,
  keys: CredentialKeys
): Promise<string> {
  const plaintext = typeof credentials === 'string' ? credentials : JSON.stringify(credentials);

  let version: 1 | 2;
  let key: CryptoKey;
  if (keys.encryptionKey) {
    version = 2;
    key = await getAesGcmKey(keys.encryptionKey, 'v2');
  } else if (keys.apiSecret) {
    if (!warnedMissingEncryptionKey) {
      console.warn('ENCRYPTION_KEY is not set: provider credentials are encrypted with a key derived from API_SECRET, which API clients also hold. Set ENCRYPTION_KEY.');
      warnedMissingEncryptionKey = true;
    }
    version = 1;
    key = await getAesGcmKey(keys.apiSecret, 'v1');
  } else {
    throw new ConfigError('ENCRYPTION_KEY (or API_SECRET) is required to encrypt provider credentials');
  }

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    v: version,
    alg: 'AES-GCM-256',
    iv: bufToHex(iv.buffer),
    data: bufToHex(ciphertext),
  });
}

/** True when the stored value is a v2 envelope (encrypted with ENCRYPTION_KEY). */
export function isCurrentCredentialEnvelope(encryptedJson: string): boolean {
  try {
    const parsed = JSON.parse(encryptedJson);
    return !!parsed && parsed.v === 2 && parsed.alg === 'AES-GCM-256';
  } catch {
    return false;
  }
}

/**
 * Decrypt provider credentials JSON.
 * Reads v2 envelopes with ENCRYPTION_KEY, v1/legacy envelopes with API_SECRET,
 * and unencrypted legacy JSON as-is (backward compatibility).
 */
export async function decryptCredentials(
  encryptedJson: string,
  keys: CredentialKeys
): Promise<Record<string, any>> {
  if (!encryptedJson) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch {
    return {};
  }

  if (parsed && typeof parsed === 'object' && parsed.alg === 'AES-GCM-256' && parsed.iv && parsed.data) {
    const iv = new Uint8Array(hexToBuf(parsed.iv));
    const data = hexToBuf(parsed.data);
    let decryptedBuf: ArrayBuffer;

    if (parsed.v === 2) {
      if (!keys.encryptionKey) {
        throw new ConfigError('ENCRYPTION_KEY is required to decrypt these provider credentials');
      }
      decryptedBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        await getAesGcmKey(keys.encryptionKey, 'v2'),
        data
      );
    } else {
      if (!keys.apiSecret) {
        throw new ConfigError('API_SECRET is required to decrypt legacy provider credentials');
      }
      try {
        decryptedBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          await getAesGcmKey(keys.apiSecret, 'v1'),
          data
        );
      } catch {
        // Fall back to the legacy non-domain-separated key
        decryptedBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv },
          await getAesGcmKey(keys.apiSecret, 'legacy'),
          data
        );
      }
    }
    return JSON.parse(new TextDecoder().decode(decryptedBuf));
  }

  // Not an envelope: legacy plaintext credentials
  return parsed;
}

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
 * Derive a 256-bit AES-GCM CryptoKey from secret using domain-separated SHA-256
 */
async function getAesGcmKey(secret: string, legacy = false): Promise<CryptoKey> {
  const keyTag = legacy ? secret : `unsent:aes-256-gcm:v1:${secret}`;
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyTag));
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt provider credentials JSON using AES-256-GCM.
 * Stores result in a versioned envelope object.
 */
export async function encryptCredentials(
  credentials: Record<string, any> | string,
  secret: string
): Promise<string> {
  const plaintext = typeof credentials === 'string' ? credentials : JSON.stringify(credentials);
  const key = await getAesGcmKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return JSON.stringify({
    v: 1,
    alg: 'AES-GCM-256',
    iv: bufToHex(iv.buffer),
    data: bufToHex(ciphertext),
  });
}

/**
 * Decrypt provider credentials JSON using AES-256-GCM.
 * Gracefully falls back to plain JSON if record is not encrypted (backward compatibility).
 */
export async function decryptCredentials(
  encryptedJson: string,
  secret?: string
): Promise<Record<string, any>> {
  if (!encryptedJson) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch {
    return {};
  }

  // Check if this is an AES-GCM encrypted envelope
  if (parsed && typeof parsed === 'object' && parsed.alg === 'AES-GCM-256' && parsed.iv && parsed.data) {
    if (!secret) {
      throw new Error('API_SECRET is required to decrypt provider credentials');
    }
    let decryptedBuf: ArrayBuffer;
    const iv = hexToBuf(parsed.iv);
    const data = hexToBuf(parsed.data);
    try {
      const key = await getAesGcmKey(secret, false);
      decryptedBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        data
      );
    } catch {
      // Fall back to legacy non-domain-separated key
      const legacyKey = await getAesGcmKey(secret, true);
      decryptedBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        legacyKey,
        data
      );
    }
    const decryptedText = new TextDecoder().decode(decryptedBuf);
    return JSON.parse(decryptedText);
  }

  // Not an envelope: legacy plaintext credentials
  return parsed;
}

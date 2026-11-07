/** Web Crypto helpers. Works on Node 20+, Bun, Deno, Workers and browsers. */

const encoder = new TextEncoder();

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('Web Crypto (globalThis.crypto.subtle) is not available in this runtime. Node 20+ is required.');
  }
  return c.subtle;
}

export function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] as number).toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  return bufToHex(await subtle().digest('SHA-256', encoder.encode(text)));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await subtle().importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return bufToHex(await subtle().sign('HMAC', key, encoder.encode(message)));
}

/** 32 hex chars of CSPRNG output; satisfies the server's `[a-zA-Z0-9_-]{8,128}` nonce rule. */
export function randomNonce(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.getRandomValues) throw new Error('Web Crypto (globalThis.crypto.getRandomValues) is not available.');
  const bytes = c.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** RFC 4122 v4 UUID. Valid as an idempotency key (printable ASCII, no spaces, < 255 chars). */
export function randomUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  if (!c?.getRandomValues) throw new Error('Web Crypto (globalThis.crypto.getRandomValues) is not available.');
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * HMAC-SHA256 signature as the Unsent server expects it:
 * `HMAC(apiSecret, timestamp + "\n" + nonce + "\n" + SHA256(body))`.
 *
 * The SDK never sends the routing headers (X-Provider-Id / X-Sender-Email); provider and sender go in
 * the signed body, so the plain canonical form is always the right one.
 */
export async function signRequest(args: {
  secret: string;
  timestamp: string;
  nonce: string;
  body: string;
}): Promise<string> {
  const bodyHash = await sha256Hex(args.body);
  return hmacSha256Hex(args.secret, `${args.timestamp}\n${args.nonce}\n${bodyHash}`);
}

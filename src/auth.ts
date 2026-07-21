import { Env } from './queue';

// --- Crypto helpers ---------------------------------------------------------

async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return bufToHex(hashBuffer);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Returns false immediately if lengths differ (length itself is not secret).
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

// --- Public exports ---------------------------------------------------------

/**
 * Lightweight API-key-only check for read-only dashboard endpoints
 * (GET /api/status, GET /api/logs). These endpoints expose no write
 * operations, so full request signing is not required.
 */
export async function verifyApiKey(request: Request, env: Env): Promise<boolean> {
  if (!env.API_KEY) return false;
  const key = request.headers.get('X-API-Key');
  if (!key) return false;
  return timingSafeEqual(key, env.API_KEY);
}

/**
 * Full request verification for POST /api/send.
 *
 * Security levels (controlled by SECURITY_MODE env var):
 *
 *  'api-key-only'  → Only checks X-API-Key header.
 *  'signed'        → Checks API key + timestamp (±3 min) + HMAC-SHA256 signature.
 *                    No nonce check — does NOT prevent replay attacks.
 *  'full' (default)→ All of the above + unique nonce stored in D1.
 *                    Fully prevents replay, tampering, and stale captures.
 *
 * Canonical message signed with HMAC-SHA256(API_SECRET, message):
 *   message = timestamp + "\n" + nonce + "\n" + SHA256(request_body)
 *
 * In 'signed' mode the nonce is the empty string, so the message becomes:
 *   message = timestamp + "\n\n" + SHA256(request_body)
 */
export async function verifyRequest(
  request: Request,
  rawBody: string,
  env: Env
): Promise<{ ok: boolean; reason?: string }> {
  const mode = (env.SECURITY_MODE || 'full').toLowerCase();

  // ── Step 1: API key (all modes) ──────────────────────────────────────────
  if (!env.API_KEY) {
    return { ok: false, reason: 'Server misconfiguration: API_KEY not set' };
  }
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || !timingSafeEqual(apiKey, env.API_KEY)) {
    return { ok: false, reason: 'Invalid API key' };
  }

  if (mode === 'api-key-only') {
    return { ok: true };
  }

  // ── Step 2: Timestamp check (±3 minutes = 180 seconds) ──────────────────
  const timestampStr = request.headers.get('X-Timestamp');
  if (!timestampStr) {
    return { ok: false, reason: 'Missing X-Timestamp header' };
  }
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { ok: false, reason: 'Invalid X-Timestamp value (must be Unix epoch seconds)' };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > 180) {
    return { ok: false, reason: 'Timestamp out of range (must be within ±3 minutes of server time in UTC)' };
  }

  // ── Step 3: Nonce presence (required in 'full' mode) ────────────────────
  const nonce = request.headers.get('X-Nonce') || '';
  if (mode === 'full' && !nonce) {
    return { ok: false, reason: 'Missing X-Nonce header (required in full security mode)' };
  }

  // ── Step 4: HMAC-SHA256 signature ────────────────────────────────────────
  if (!env.API_SECRET) {
    return { ok: false, reason: 'Server misconfiguration: API_SECRET not set' };
  }
  const signature = request.headers.get('X-Signature');
  if (!signature) {
    return { ok: false, reason: 'Missing X-Signature header' };
  }

  // Canonical message format:
  //   timestamp + "\n" + nonce + "\n" + SHA256(rawBody)
  // (nonce is "" in 'signed' mode, so the two \n are consecutive)
  const bodyHash = await sha256Hex(rawBody);
  const canonicalMessage = timestampStr + '\n' + nonce + '\n' + bodyHash;
  const expectedSig = await hmacSha256Hex(env.API_SECRET, canonicalMessage);

  if (!timingSafeEqual(signature, expectedSig)) {
    return { ok: false, reason: 'Invalid signature (body may have been tampered with)' };
  }

  if (mode !== 'full') {
    return { ok: true };
  }

  // ── Step 5: Nonce replay protection ──────────────────────────────────────
  const ttlSeconds = parseInt(env.NONCE_TTL_SECONDS || '300', 10);
  const nowSecs = Math.floor(Date.now() / 1000);

  // Sweep expired nonces first (best-effort, no await needed but useful for cleanup)
  try {
    await env.DB.prepare('DELETE FROM used_nonces WHERE expires_at < ?1')
      .bind(nowSecs)
      .run();
  } catch (e) {
    // Non-fatal — sweep failure shouldn't block the request
    console.error('Nonce sweep failed:', e);
  }

  // Check for duplicate
  const existing = await env.DB.prepare(
    'SELECT 1 FROM used_nonces WHERE nonce = ?1'
  ).bind(nonce).first();

  if (existing) {
    return { ok: false, reason: 'Nonce already used (replay attack detected)' };
  }

  // Store nonce with expiry
  await env.DB.prepare(
    'INSERT INTO used_nonces (nonce, expires_at) VALUES (?1, ?2)'
  ).bind(nonce, nowSecs + ttlSeconds).run();

  return { ok: true };
}

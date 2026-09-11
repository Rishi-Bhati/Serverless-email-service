import type { Env } from './queue';
import { getActiveProviders, getProviderById, getActiveProviderByEmail, type ProviderRecord } from './providers';

import {
  bufToHex,
  hexToBuf,
  sha256Hex,
  hmacSha256Hex,
  timingSafeEqual,
  encryptCredentials,
  decryptCredentials,
} from './crypto';

export {
  bufToHex,
  hexToBuf,
  sha256Hex,
  hmacSha256Hex,
  timingSafeEqual,
  encryptCredentials,
  decryptCredentials,
};

// --- Public exports ---------------------------------------------------------

/**
 * Lightweight API-key-only check for read-only or admin endpoints
 */
export async function verifyApiKey(request: Request, env: Env): Promise<boolean> {
  if (!env.API_KEY) return false;
  const key = request.headers.get('X-API-Key');
  if (!key) return false;
  return timingSafeEqual(key, env.API_KEY);
}

export interface AuthResult {
  ok: boolean;
  reason?: string;
  explicitSenderEmail?: string;
  explicitProviderId?: string;
  matchedProvider?: ProviderRecord | null;
}

/**
 * Validate that an explicit sender email or provider ID belongs to an active,
 * configured provider in D1 (or matches env SMTP fallback).
 */
export async function validateSenderAuthorization(
  env: Env,
  senderEmail?: string,
  providerId?: string
): Promise<{ ok: boolean; reason?: string; provider?: ProviderRecord | null }> {
  // If neither is explicitly requested, authorization is approved (uses default / priority order)
  if (!senderEmail && !providerId) {
    return { ok: true, provider: null };
  }

  const allActive = await getActiveProviders(env.DB).catch(() => []);

  // If no providers are configured in D1 yet, check env fallback
  if (allActive.length === 0) {
    if (senderEmail && env.SMTP_FROM_EMAIL && senderEmail.toLowerCase() === env.SMTP_FROM_EMAIL.toLowerCase()) {
      return { ok: true, provider: null };
    }
    if (!senderEmail && !providerId) {
      return { ok: true, provider: null };
    }
    return {
      ok: false,
      reason: `Unauthorized sender or provider. No providers matching "${senderEmail || providerId}" are configured.`,
    };
  }

  // Check explicit provider ID if supplied
  if (providerId) {
    const p = allActive.find(item => item.id === providerId);
    if (!p) {
      return {
        ok: false,
        reason: `Provider with ID "${providerId}" is not found or is inactive.`,
      };
    }
    if (senderEmail && p.from_email.toLowerCase() !== senderEmail.toLowerCase()) {
      return {
        ok: false,
        reason: `Sender email "${senderEmail}" does not match the configured address for provider "${providerId}" ("${p.from_email}").`,
      };
    }
    return { ok: true, provider: p };
  }

  // Check explicit sender email if supplied
  if (senderEmail) {
    const p = allActive.find(item => item.from_email.toLowerCase() === senderEmail.toLowerCase());
    if (!p) {
      return {
        ok: false,
        reason: `Sender email "${senderEmail}" is not configured in allowed active providers.`,
      };
    }
    return { ok: true, provider: p };
  }

  return { ok: true, provider: null };
}

/**
 * Full request verification for POST /api/send.
 *
 * Security levels (controlled by SECURITY_MODE env var):
 *  'api-key-only'  → Only checks X-API-Key header.
 *  'signed'        → Checks API key + timestamp (±3 min) + HMAC-SHA256 signature.
 *  'full' (default)→ All of the above + unique nonce stored in D1.
 *
 * Canonical message signed with HMAC-SHA256(API_SECRET, message):
 *   Standard:        timestamp + "\n" + nonce + "\n" + SHA256(request_body)
 *   Header-bound:    timestamp + "\n" + nonce + "\n" + (X-Sender-Email || X-Provider-Id || "") + "\n" + SHA256(request_body)
 */
export async function verifyRequest(
  request: Request,
  rawBody: string,
  env: Env
): Promise<AuthResult> {
  const mode = (env.SECURITY_MODE || 'full').toLowerCase();

  // ── Step 0: Dashboard authenticated session (Bearer token) ──────────────
  const authHeader = request.headers.get('Authorization') || '';
  const sessionToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : request.headers.get('X-Session-Token');

  if (sessionToken) {
    const session = await verifySessionToken(sessionToken, env.API_SECRET || env.API_KEY || 'unsent_secret');
    if (session.ok) {
      const headerSender = request.headers.get('X-Sender-Email') || '';
      const headerProviderId = request.headers.get('X-Provider-Id') || '';
      return {
        ok: true,
        explicitSenderEmail: headerSender || undefined,
        explicitProviderId: headerProviderId || undefined,
      };
    }
  }

  // ── Step 1: API key (all modes) ──────────────────────────────────────────
  if (!env.API_KEY) {
    return { ok: false, reason: 'Server misconfiguration: API_KEY not set' };
  }
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey || !timingSafeEqual(apiKey, env.API_KEY)) {
    return { ok: false, reason: 'Invalid API key' };
  }

  // Extract explicit sender / provider headers
  const headerSender = request.headers.get('X-Sender-Email') || '';
  const headerProviderId = request.headers.get('X-Provider-Id') || '';

  if (mode === 'api-key-only') {
    return {
      ok: true,
      explicitSenderEmail: headerSender || undefined,
      explicitProviderId: headerProviderId || undefined,
    };
  }

  // ── Step 2: Timestamp check (±3 minutes = 180 seconds) ──────────────────
  const timestampStr = request.headers.get('X-Timestamp');
  if (!timestampStr || !/^\d+$/.test(timestampStr.trim())) {
    return { ok: false, reason: 'Invalid or missing X-Timestamp header (must be Unix epoch seconds)' };
  }
  const timestamp = parseInt(timestampStr.trim(), 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > 180) {
    return { ok: false, reason: 'Timestamp out of range (must be within ±3 minutes of server time in UTC)' };
  }

  // ── Step 3: Nonce presence & format (required in 'full' mode) ────────────
  const rawNonce = request.headers.get('X-Nonce') || '';
  if (mode === 'full' && !rawNonce) {
    return { ok: false, reason: 'Missing X-Nonce header (required in full security mode)' };
  }
  if (rawNonce && !/^[a-zA-Z0-9_-]{8,128}$/.test(rawNonce.trim())) {
    return { ok: false, reason: 'Invalid X-Nonce format (must be 8-128 alphanumeric characters, dashes, or underscores)' };
  }
  const nonce = rawNonce.trim();

  // Validate routing headers against CRLF / canonical injection
  if (headerProviderId && !/^[a-zA-Z0-9_-]{1,64}$/.test(headerProviderId)) {
    return { ok: false, reason: 'Invalid X-Provider-Id header format' };
  }
  if (headerSender && /[\r\n\0]/.test(headerSender)) {
    return { ok: false, reason: 'Invalid X-Sender-Email header format' };
  }

  // ── Step 4: HMAC-SHA256 signature ────────────────────────────────────────
  if (!env.API_SECRET) {
    return { ok: false, reason: 'Server misconfiguration: API_SECRET not set' };
  }
  const signature = request.headers.get('X-Signature');
  if (!signature) {
    return { ok: false, reason: 'Missing X-Signature header' };
  }

  // Normalize signature: accept both "sha256=<hex>" and bare "<hex>" formats in any casing.
  const rawSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  const normalizedSig = rawSig.toLowerCase().trim();
  if (!/^[a-f0-9]{64}$/.test(normalizedSig)) {
    return { ok: false, reason: 'Invalid signature format (must be SHA-256 hex string)' };
  }

  const bodyHash = await sha256Hex(rawBody);

  // Security model for provider routing headers:
  //   - If X-Provider-Id or X-Sender-Email are present → ONLY accept the header-bound
  //     canonical form. Accepting the standard form here would allow an attacker to inject
  //     provider headers onto a validly-signed request (MITM escalation).
  //   - If no routing headers → accept the standard canonical form only.
  let isValidSig = false;

  if (headerSender || headerProviderId) {
    // Header-bound only: timestamp + "\n" + nonce + "\n" + qualifier + "\n" + bodyHash
    const senderQualifier = headerProviderId
      ? `provider:${headerProviderId}`
      : `email:${headerSender}`;
    const headerBoundMsg = timestampStr.trim() + '\n' + nonce + '\n' + senderQualifier + '\n' + bodyHash;
    const expectedSigHeader = await hmacSha256Hex(env.API_SECRET, headerBoundMsg);
    isValidSig = timingSafeEqual(normalizedSig, expectedSigHeader);

    // Also try legacy qualifier format (just the raw header value, no prefix) for
    // backward compatibility with clients that signed before the prefix convention.
    if (!isValidSig) {
      const legacyQualifier = headerSender || headerProviderId;
      const legacyMsg = timestampStr.trim() + '\n' + nonce + '\n' + legacyQualifier + '\n' + bodyHash;
      const expectedSigLegacy = await hmacSha256Hex(env.API_SECRET, legacyMsg);
      isValidSig = timingSafeEqual(normalizedSig, expectedSigLegacy);
    }
  } else {
    // Standard canonical: timestamp + "\n" + nonce + "\n" + bodyHash
    const standardMsg = timestampStr.trim() + '\n' + nonce + '\n' + bodyHash;
    const expectedSigStandard = await hmacSha256Hex(env.API_SECRET, standardMsg);
    isValidSig = timingSafeEqual(normalizedSig, expectedSigStandard);
  }

  if (!isValidSig) {
    return { ok: false, reason: 'Invalid signature (request headers or body may have been tampered with)' };
  }

  if (mode !== 'full') {
    return {
      ok: true,
      explicitSenderEmail: headerSender || undefined,
      explicitProviderId: headerProviderId || undefined,
    };
  }

  // ── Step 5: Atomic Nonce Replay Protection ──────────────────────────────
  const ttlSeconds = parseInt(env.NONCE_TTL_SECONDS || '300', 10);
  const nowSecs = Math.floor(Date.now() / 1000);
  // Guarantee nonce expires strictly AFTER the timestamp acceptance window closes
  const nonceExpiresAt = Math.max(nowSecs, timestamp) + ttlSeconds + 180;

  // Nonce sweep runs asynchronously / opportunistically (non-blocking)
  try {
    await env.DB.prepare('DELETE FROM used_nonces WHERE expires_at < ?1')
      .bind(nowSecs)
      .run();
  } catch (e) {
    console.error('Nonce sweep failed:', e);
  }

  // Atomic INSERT into used_nonces: relies on SQLite PRIMARY KEY constraint
  // to eliminate TOCTOU race conditions across concurrent worker threads.
  try {
    const insertRes = await env.DB.prepare(
      'INSERT INTO used_nonces (nonce, expires_at) VALUES (?1, ?2)'
    ).bind(nonce, nonceExpiresAt).run();

    if (!insertRes.success) {
      return { ok: false, reason: 'Nonce already used (replay attack detected)' };
    }
  } catch (dbErr: any) {
    const errMsg = String(dbErr?.message || dbErr);
    if (errMsg.includes('UNIQUE') || errMsg.includes('constraint')) {
      return { ok: false, reason: 'Nonce already used (replay attack detected)' };
    }
    throw dbErr;
  }

  return {
    ok: true,
    explicitSenderEmail: headerSender || undefined,
    explicitProviderId: headerProviderId || undefined,
  };
}

/**
 * Create a signed session token for authenticated dashboard sessions.
 * Token structure: base64(username:expiresAt) + "." + signature
 */
export async function createSessionToken(username: string, secret: string): Promise<string> {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  const payload = `${username}:${expiresAt}`;
  const payloadB64 = btoa(payload);
  const sig = await hmacSha256Hex(secret, payload);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed dashboard session token.
 */
export async function verifySessionToken(
  token: string,
  secret: string
): Promise<{ ok: boolean; username?: string }> {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false };
  const [payloadB64, sig] = parts;
  try {
    const payload = atob(payloadB64);
    const colonIdx = payload.lastIndexOf(':');
    if (colonIdx === -1) return { ok: false };
    const username = payload.slice(0, colonIdx);
    const expiresAt = parseInt(payload.slice(colonIdx + 1), 10);
    if (isNaN(expiresAt) || Date.now() > expiresAt) return { ok: false };

    const expectedSig = await hmacSha256Hex(secret, payload);
    if (!timingSafeEqual(sig.toLowerCase(), expectedSig.toLowerCase())) {
      return { ok: false };
    }
    return { ok: true, username };
  } catch {
    return { ok: false };
  }
}

/**
 * Verify username & password against env variables.
 */
export async function verifyAdminCredentials(
  user: string,
  pass: string,
  env: Env
): Promise<boolean> {
  const expectedUser = env.ADMIN_USERNAME || env.DASHBOARD_USERNAME || 'admin';
  const expectedPass = env.ADMIN_PASSWORD || env.DASHBOARD_PASSWORD || env.API_SECRET || env.API_KEY || 'unsent_admin_2026!';

  if (!user || !pass) return false;
  const userOk = timingSafeEqual(user.trim(), expectedUser.trim());
  const passOk = timingSafeEqual(pass.trim(), expectedPass.trim());
  return userOk && passOk;
}


import { createHash, createHmac } from 'node:crypto';

export const BASE = 'https://unsent.test';
export const API_KEY = 'test-api-key';
export const API_SECRET = 'test-api-secret';

export interface Recorded {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
  json: any;
}

export type Handler = (req: Recorded, n: number) => Response | Promise<Response>;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** A fake `fetch` that records requests and delegates to a handler. Honors AbortSignal. */
export function mockFetch(handler: Handler) {
  const calls: Recorded[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const body = typeof init?.body === 'string' ? init.body : '';
    const rec: Recorded = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body,
      json: body ? JSON.parse(body) : undefined,
    };
    calls.push(rec);
    const signal = init?.signal;
    if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError');
    const result = Promise.resolve(handler(rec, calls.length));
    if (!signal) return result;
    return Promise.race([
      result,
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true }),
      ),
    ]);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

/**
 * Independent re-implementation of the Unsent server's checks (src/auth.ts, `full` mode, no routing headers),
 * built on node:crypto rather than the SDK's Web Crypto code.
 */
export function verifySigned(req: Recorded, secret = API_SECRET, usedNonces?: Set<string>): { ok: true } | { ok: false; code: string } {
  if (req.headers.get('X-API-Key') !== API_KEY) return { ok: false, code: 'invalid_api_key' };
  const ts = req.headers.get('X-Timestamp') ?? '';
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 180) return { ok: false, code: 'timestamp_skew' };
  const nonce = req.headers.get('X-Nonce') ?? '';
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(nonce)) return { ok: false, code: 'invalid_nonce' };
  const sig = (req.headers.get('X-Signature') ?? '').replace(/^sha256=/, '').toLowerCase();
  const bodyHash = createHash('sha256').update(req.body).digest('hex');
  const expected = createHmac('sha256', secret).update(`${ts}\n${nonce}\n${bodyHash}`).digest('hex');
  if (sig !== expected) return { ok: false, code: 'invalid_signature' };
  if (usedNonces) {
    if (usedNonces.has(nonce)) return { ok: false, code: 'nonce_reused' };
    usedNonces.add(nonce);
  }
  if (req.headers.has('X-Provider-Id') || req.headers.has('X-Sender-Email')) return { ok: false, code: 'invalid_signature' };
  return { ok: true };
}

export const accepted = (id = 1, extra: Record<string, unknown> = {}) =>
  json(
    {
      success: true,
      id,
      status: 'queued',
      idempotent_replay: false,
      message: 'Email successfully queued for sending',
      targetProvider: 'Automatic Priority / Default',
      ...extra,
    },
    202,
  );

export const apiError = (status: number, code: string, error = 'Error', reason?: string, headers: Record<string, string> = {}) =>
  json({ error, code, ...(reason && { reason }) }, status, headers);

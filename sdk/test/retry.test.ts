import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Unsent,
  UnsentAuthenticationError,
  UnsentConflictError,
  UnsentConnectionError,
  UnsentError,
  UnsentPermissionError,
  UnsentRateLimitError,
  UnsentRequestError,
  UnsentServerError,
  UnsentTimeoutError,
} from '../src';
import { API_KEY, API_SECRET, BASE, accepted, apiError, json, mockFetch, verifySigned, type Handler } from './helpers';

const msg = { to: 'a@b.co', subject: 's', html: 'h' };

function setup(handler: Handler, opts: Record<string, unknown> = {}) {
  const m = mockFetch(handler);
  return { m, unsent: new Unsent({ baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch, ...opts }) };
}

// Web Crypto completes on the real thread pool, so fake time must be pumped in small steps with real
// pauses in between; otherwise timers get armed after the clock has already moved on.
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

async function pump(totalMs: number, stepMs = 50): Promise<void> {
  for (let t = 0; t < totalMs; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    await realSleep(1);
  }
}

/** Resolve a promise, advancing fake time until it settles. */
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const guarded = p.then(
    (v) => ({ v }),
    (e) => ({ e }),
  );
  void guarded.then(() => (done = true));
  for (let i = 0; i < 2000 && !done; i++) {
    await vi.advanceTimersByTimeAsync(250);
    await realSleep(1);
  }
  const r = await guarded;
  if ('e' in r) throw r.e;
  return r.v;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('retries', () => {
  it('retries 5xx with the SAME idempotency key but a FRESH nonce and signature', async () => {
    const { m, unsent } = setup((_r, n) => (n < 3 ? apiError(500, 'internal_error', 'Internal server error') : accepted(5)));
    const res = await settle(unsent.send(msg));
    expect(res.id).toBe(5);
    expect(m.calls).toHaveLength(3);
    const keys = new Set(m.calls.map((c) => c.json.idempotency_key));
    const nonces = new Set(m.calls.map((c) => c.headers.get('X-Nonce')));
    expect(keys.size).toBe(1);
    expect(nonces.size).toBe(3);
    const used = new Set<string>();
    for (const c of m.calls) expect(verifySigned(c, API_SECRET, used)).toEqual({ ok: true });
  });

  it('retries 502/503/504, 408 and 429, honoring Retry-After', async () => {
    for (const status of [408, 429, 502, 503, 504]) {
      const { m, unsent } = setup((_r, n) => (n === 1 ? apiError(status, 'x', 'e', undefined, { 'Retry-After': '2' }) : accepted()));
      const p = unsent.send(msg);
      await pump(1900);
      expect(m.calls).toHaveLength(1); // still waiting for Retry-After: 2s
      await settle(p);
      expect(m.calls).toHaveLength(2);
    }
  });

  it('retries network errors', async () => {
    const { m, unsent } = setup((_r, n) => {
      if (n < 3) throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
      return accepted();
    });
    await settle(unsent.send(msg));
    expect(m.calls).toHaveLength(3);
  });

  it('gives up after maxRetries and surfaces the last error', async () => {
    const { m, unsent } = setup(() => apiError(503, 'x', 'Unavailable'), { maxRetries: 2 });
    const err = await settle(unsent.send(msg)).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentServerError);
    expect(err.status).toBe(503);
    expect(m.calls).toHaveLength(3);
  });

  it('maxRetries: 0 (client or per-call) disables retries', async () => {
    const a = setup(() => apiError(500, 'internal_error'), { maxRetries: 0 });
    await expect(a.unsent.send(msg)).rejects.toBeInstanceOf(UnsentServerError);
    expect(a.m.calls).toHaveLength(1);
    const b = setup(() => apiError(500, 'internal_error'));
    await expect(b.unsent.send({ ...msg, maxRetries: 0 })).rejects.toBeInstanceOf(UnsentServerError);
    expect(b.m.calls).toHaveLength(1);
  });

  it.each([
    [400, 'validation_error', UnsentRequestError],
    [400, 'unauthorized_sender', UnsentRequestError],
    [401, 'invalid_api_key', UnsentAuthenticationError],
    [401, 'invalid_signature', UnsentAuthenticationError],
    [403, 'forbidden', UnsentPermissionError],
    [409, 'idempotency_key_conflict', UnsentConflictError],
    [413, 'payload_too_large', UnsentRequestError],
    [500, 'server_misconfigured', UnsentServerError],
    [501, 'x', UnsentServerError],
  ])('does not retry %i %s', async (status, code, Cls) => {
    const { m, unsent } = setup(() => apiError(status, code, 'nope'));
    await expect(unsent.send(msg)).rejects.toBeInstanceOf(Cls);
    expect(m.calls).toHaveLength(1);
  });

  it('never retries a send with idempotencyKey: false (a retry could duplicate the email)', async () => {
    const net = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(net.unsent.send({ ...msg, idempotencyKey: false })).rejects.toBeInstanceOf(UnsentConnectionError);
    expect(net.m.calls).toHaveLength(1);
    const srv = setup(() => apiError(500, 'internal_error'));
    await expect(srv.unsent.send({ ...msg, idempotencyKey: false })).rejects.toBeInstanceOf(UnsentServerError);
    expect(srv.m.calls).toHaveLength(1);
  });

  it('a retried send whose first attempt actually landed resolves as an idempotent replay', async () => {
    const { m, unsent } = setup((_r, n) =>
      n === 1
        ? apiError(502, 'x', 'Bad gateway')
        : json({ success: true, id: 4, status: 'queued', idempotent_replay: true, message: 'm', targetProvider: 'p' }, 200, { 'Idempotent-Replayed': 'true' }),
    );
    const res = await settle(unsent.send(msg));
    expect(res).toMatchObject({ id: 4, idempotentReplay: true });
    expect(m.calls).toHaveLength(2);
  });
});

describe('clock skew', () => {
  it('learns the server clock from the Date header and retries once, correctly signed', async () => {
    const serverNow = Date.now() + 10 * 60_000; // client clock is 10 minutes slow
    const { m, unsent } = setup((req) => {
      const ts = Number(req.headers.get('X-Timestamp'));
      if (Math.abs(serverNow / 1000 - ts) > 180) {
        return apiError(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range', { Date: new Date(serverNow).toUTCString() });
      }
      return accepted(8);
    });
    const res = await unsent.send(msg);
    expect(res.id).toBe(8);
    expect(m.calls).toHaveLength(2);
    // the offset is remembered, so later calls succeed first time
    await unsent.send(msg);
    expect(m.calls).toHaveLength(3);
  });

  it('falls back to the health probe when the response has no Date header', async () => {
    const serverNow = () => Date.now() + 10 * 60_000;
    const { m, unsent } = setup((req) => {
      if (req.url.pathname === '/api/health') return json({ status: 'ok', timestamp: serverNow() });
      const ts = Number(req.headers.get('X-Timestamp'));
      return Math.abs(serverNow() / 1000 - ts) > 180 ? apiError(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range') : accepted(11);
    });
    const res = await settle(unsent.send(msg));
    expect(res.id).toBe(11);
    expect(m.calls.map((c) => c.url.pathname)).toEqual(['/api/send', '/api/health', '/api/send']);
    expect(m.calls[1]!.headers.has('X-API-Key')).toBe(false);
  });

  it('drops a stale offset when the host clock has since been fixed', async () => {
    let skewMs = 10 * 60_000; // server is 10 minutes ahead of the client
    const { m, unsent } = setup((req) => {
      const serverNow = Date.now() + skewMs;
      if (req.url.pathname === '/api/health') return json({ status: 'ok', timestamp: serverNow });
      const ts = Number(req.headers.get('X-Timestamp'));
      return Math.abs(serverNow / 1000 - ts) > 180 ? apiError(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range') : accepted();
    });
    await settle(unsent.send(msg)); // learns +10 min
    skewMs = 0; // operator fixes the clock
    await settle(unsent.send(msg)); // stale offset now wrong; must self-heal
    const sends = m.calls.filter((c) => c.url.pathname === '/api/send');
    expect(sends).toHaveLength(4); // 2 + 2: each call needed one corrected retry
    await settle(unsent.send(msg));
    expect(m.calls.filter((c) => c.url.pathname === '/api/send')).toHaveLength(5); // healthy again
  });

  it('gives up cleanly when the health probe is unreachable', async () => {
    const { m, unsent } = setup((req) => {
      if (req.url.pathname === '/api/health') throw new TypeError('fetch failed');
      return apiError(401, 'timestamp_skew', 'Unauthorized', 'Timestamp out of range');
    });
    await expect(settle(unsent.send(msg))).rejects.toMatchObject({ code: 'timestamp_skew' });
    expect(m.calls.filter((c) => c.url.pathname === '/api/send')).toHaveLength(1);
  });

  it('does not loop when the skew persists', async () => {
    const { m, unsent } = setup(() => apiError(401, 'timestamp_skew', 'Unauthorized', 'bad', { Date: new Date(Date.now() + 3_600_000).toUTCString() }));
    const err = await unsent.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentAuthenticationError);
    expect(err.code).toBe('timestamp_skew');
    expect(m.calls).toHaveLength(2);
  });

  it('ignores small skews it cannot be the cause of', async () => {
    const { m, unsent } = setup(() => apiError(401, 'timestamp_skew', 'Unauthorized', 'bad', { Date: new Date().toUTCString() }));
    await expect(unsent.send(msg)).rejects.toMatchObject({ code: 'timestamp_skew' });
    expect(m.calls).toHaveLength(1);
  });
});

describe('timeouts and aborts', () => {
  it('times out a hung request and retries it', async () => {
    const { m, unsent } = setup((_r, n) => (n === 1 ? new Promise<Response>(() => {}) : accepted()), { timeoutMs: 1000 });
    const res = await settle(unsent.send(msg));
    expect(res.id).toBe(1);
    expect(m.calls).toHaveLength(2);
  });

  it('surfaces UnsentTimeoutError when every attempt hangs', async () => {
    const { unsent } = setup(() => new Promise<Response>(() => {}), { timeoutMs: 500, maxRetries: 1 });
    const err = await settle(unsent.send(msg)).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentTimeoutError);
    expect(err).toBeInstanceOf(UnsentConnectionError);
    expect(err.code).toBe('timeout');
  });

  it('honors a per-call timeoutMs', async () => {
    const { unsent } = setup(() => new Promise<Response>(() => {}), { maxRetries: 0 });
    const p = unsent.send({ ...msg, timeoutMs: 50 }).catch((e) => e);
    await pump(100, 10);
    expect(await p).toBeInstanceOf(UnsentTimeoutError);
  });

  it('abort via signal stops immediately without retrying', async () => {
    const ac = new AbortController();
    const { m, unsent } = setup(() => new Promise<Response>(() => {}));
    const p = unsent.send({ ...msg, signal: ac.signal }).catch((e) => e);
    await pump(50, 10);
    ac.abort();
    const err = await p;
    expect(err).toBeInstanceOf(UnsentError);
    expect(err.code).toBe('aborted');
    expect(m.calls).toHaveLength(1);
  });

  it('abort during backoff stops waiting', async () => {
    const ac = new AbortController();
    const { m, unsent } = setup(() => apiError(500, 'internal_error'));
    const p = unsent.send({ ...msg, signal: ac.signal }).catch((e) => e);
    await pump(50, 10); // first attempt done, now backing off
    ac.abort();
    expect((await p).code).toBe('aborted');
    expect(m.calls).toHaveLength(1);
  });

  it('an already-aborted signal never touches the network', async () => {
    const { m, unsent } = setup(() => accepted());
    const err = await unsent.send({ ...msg, signal: AbortSignal.abort() }).catch((e) => e);
    expect(err.code).toBe('aborted');
    expect(m.calls).toHaveLength(0);
  });
});

describe('error mapping', () => {
  it('exposes status, code, reason, body and a helpful hint', async () => {
    const { unsent } = setup(() => apiError(401, 'invalid_signature', 'Unauthorized', 'Invalid signature (request headers or body may have been tampered with)'));
    const err = await unsent.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentAuthenticationError);
    expect(err.name).toBe('UnsentAuthenticationError');
    expect(err.status).toBe(401);
    expect(err.code).toBe('invalid_signature');
    expect(err.reason).toMatch(/tampered/);
    expect(err.hint).toMatch(/apiSecret/);
    expect(err.message).toMatch(/Unauthorized.*tampered.*apiSecret/s);
    expect(err.body).toEqual({ error: 'Unauthorized', code: 'invalid_signature', reason: expect.any(String) });
  });

  it('points at apiSecret when a signing-required server rejects an unsigned request', async () => {
    const m = mockFetch(() => apiError(401, 'timestamp_skew', 'Unauthorized', 'Invalid or missing X-Timestamp header'));
    const err = await new Unsent({ baseUrl: BASE, apiKey: API_KEY, fetch: m.fetch }).send(msg).catch((e) => e);
    expect(err.hint).toMatch(/requires signed requests/);
  });

  it('surfaces the conflicting email id on idempotency conflicts', async () => {
    const { unsent } = setup(() => json({ error: 'Idempotency key was already used for a different email', code: 'idempotency_key_conflict', id: 77 }, 409));
    const err = await unsent.send({ ...msg, idempotencyKey: 'k' }).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentConflictError);
    expect(err.existingEmailId).toBe(77);
  });

  it('parses Retry-After on 429', async () => {
    const { unsent } = setup(() => apiError(429, 'rate_limited', 'slow down', undefined, { 'Retry-After': '7' }), { maxRetries: 0 });
    const err = await unsent.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentRateLimitError);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('handles non-JSON error bodies from proxies and CDNs', async () => {
    const { unsent } = setup(() => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }), { maxRetries: 0 });
    const err = await unsent.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentServerError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('internal_error');
  });

  it('handles an empty error body', async () => {
    const { unsent } = setup(() => new Response(null, { status: 404, statusText: 'Not Found' }));
    const err = await unsent.status().catch((e) => e);
    expect(err.status).toBe(404);
    expect(err.code).toBe('http_404');
    expect(err.message).toBe('Not Found');
  });

  it('flags a 200 with a non-JSON body (wrong baseUrl)', async () => {
    const { unsent } = setup(() => new Response('<!doctype html>hi', { status: 200 }));
    const err = await unsent.status().catch((e) => e);
    expect(err.code).toBe('invalid_response');
    expect(err.message).toMatch(/baseUrl/);
  });

  it('describes connection failures with the host and root cause', async () => {
    const { unsent } = setup(
      () => {
        throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND unsent.test') });
      },
      { maxRetries: 0 },
    );
    const err = await unsent.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentConnectionError);
    expect(err.message).toMatch(/unsent\.test.*ENOTFOUND/s);
  });

  it('never follows redirects (they would forward the API key to another host)', async () => {
    let redirectMode: unknown;
    const m = mockFetch(() => new Response(null, { status: 308, headers: { Location: 'https://elsewhere.test/api/status' } }));
    const unsent = new Unsent({
      baseUrl: BASE,
      apiKey: API_KEY,
      fetch: ((u: any, init: RequestInit) => {
        redirectMode = init.redirect;
        return m.fetch(u, init);
      }) as typeof fetch,
    });
    const err = await unsent.status().catch((e) => e);
    expect(redirectMode).toBe('manual');
    expect(err).toBeInstanceOf(UnsentError);
    expect(err.code).toBe('unexpected_redirect');
    expect(err.message).toMatch(/redirected to https:\/\/elsewhere\.test/);
    expect(m.calls).toHaveLength(1); // not retried
  });
});

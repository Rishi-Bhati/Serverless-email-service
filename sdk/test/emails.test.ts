import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_DELIVERY_ATTEMPTS, Unsent, UnsentNotFoundError, UnsentTimeoutError, UnsentValidationError } from '../src';
import { API_KEY, BASE, apiError, json, mockFetch, type Handler } from './helpers';

function setup(handler: Handler) {
  const m = mockFetch(handler);
  return { m, unsent: new Unsent({ baseUrl: BASE, apiKey: API_KEY, fetch: m.fetch, maxRetries: 0 }) };
}

// Shapes copied from GET /api/emails and GET /api/emails/:id in src/index.ts.
const listRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  to_json: '["a@b.co"]',
  subject: 'Hello',
  body: '<p>Hi</p>',
  html_body: '<p>Hi</p>',
  text_body: '<p>Hi</p>', // API falls back to html when no text part was stored
  from_email: 'me@x.co',
  from_name: 'Me',
  provider_id: null,
  provider_used: 'SES',
  failover_history: '[{"provider":"SMTP","type":"smtp","error":"timeout","timestamp":1780000000000}]',
  idempotency_key: 'k-1',
  status: 'sent',
  attempts: 1,
  error: null,
  error_message: null,
  created_at: 1780000000000,
  updated_at: 1780000005000,
  to: ['a@b.co'],
  cc: undefined,
  bcc: undefined,
  attachments: [{ filename: 'a.pdf', mimeType: 'application/pdf', size: 1234 }],
  attachment_count: 1,
  ...over,
});

describe('emails.get', () => {
  it('maps the detail response to camelCase with Dates and decoded attachment sizes', async () => {
    const { m, unsent } = setup(() =>
      json({
        email: listRow({
          text_body: 'Hi',
          cc: ['c@d.co'],
          attachments: [{ filename: 'a.txt', mimeType: 'text/plain', content: 'aGVsbG8=' }],
        }),
      }),
    );
    const e = await unsent.emails.get(3);
    expect(m.calls[0]!.url.pathname).toBe('/api/emails/3');
    expect(m.calls[0]!.headers.get('X-API-Key')).toBe(API_KEY);
    expect(m.calls[0]!.headers.has('X-Signature')).toBe(false);
    expect(e).toMatchObject({
      id: 3,
      status: 'sent',
      to: ['a@b.co'],
      cc: ['c@d.co'],
      bcc: null,
      subject: 'Hello',
      htmlBody: '<p>Hi</p>',
      textBody: 'Hi',
      fromEmail: 'me@x.co',
      fromName: 'Me',
      providerUsed: 'SES',
      idempotencyKey: 'k-1',
      attempts: 1,
      error: null,
    });
    expect(e.createdAt).toEqual(new Date(1780000000000));
    expect(e.updatedAt).toEqual(new Date(1780000005000));
    expect(e.failoverHistory).toEqual([{ provider: 'SMTP', type: 'smtp', error: 'timeout', timestamp: new Date(1780000000000) }]);
    expect(e.attachments).toEqual([{ filename: 'a.txt', mimeType: 'text/plain', size: 5, content: 'aGVsbG8=' }]);
  });

  it('reports textBody as null when the API only echoed the HTML body', async () => {
    const { unsent } = setup(() => json({ email: listRow() }));
    expect((await unsent.emails.get(3)).textBody).toBeNull();
  });

  it('throws UnsentNotFoundError for unknown ids', async () => {
    const { unsent } = setup(() => apiError(404, 'not_found', 'Email not found'));
    await expect(unsent.emails.get(999)).rejects.toBeInstanceOf(UnsentNotFoundError);
  });

  it.each([0, -1, 1.5, Number.NaN, '3' as unknown as number])('rejects invalid id %j without a request', async (id) => {
    const { m, unsent } = setup(() => json({}));
    await expect(unsent.emails.get(id)).rejects.toBeInstanceOf(UnsentValidationError);
    expect(m.calls).toHaveLength(0);
  });

  it('tolerates a malformed failover_history', async () => {
    const { unsent } = setup(() => json({ email: listRow({ failover_history: '{not json' }) }));
    expect((await unsent.emails.get(3)).failoverHistory).toEqual([]);
  });
});

describe('emails.list', () => {
  it('builds the query and maps the page', async () => {
    const { m, unsent } = setup(() => json({ emails: [listRow(), listRow({ id: 2 })], results: [], total: 5, limit: 2, offset: 0 }));
    const page = await unsent.emails.list({
      limit: 2,
      status: 'failed',
      search: 'invoice',
      from: new Date('2026-01-05T23:00:00Z'),
      to: '2026-02-01',
      sort: 'created_at_asc',
    });
    const q = m.calls[0]!.url.searchParams;
    expect(Object.fromEntries(q)).toEqual({ limit: '2', status: 'failed', q: 'invoice', from: '2026-01-05', to: '2026-02-01', sort: 'created_at_asc' });
    expect(page.emails.map((e) => e.id)).toEqual([3, 2]);
    expect(page).toMatchObject({ total: 5, limit: 2, offset: 0, hasMore: true });
    expect(page.emails[0]!.attachments).toEqual([{ filename: 'a.pdf', mimeType: 'application/pdf', size: 1234 }]);
  });

  it('omits unset params and reports hasMore=false on the last page', async () => {
    const { m, unsent } = setup(() => json({ emails: [listRow()], total: 1, limit: 100, offset: 0 }));
    const page = await unsent.emails.list();
    expect([...m.calls[0]!.url.searchParams]).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it.each([{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }, { from: 'yesterday' }, { to: new Date('nope') }])('rejects invalid %j', async (opts) => {
    const { m, unsent } = setup(() => json({}));
    await expect(unsent.emails.list(opts as any)).rejects.toBeInstanceOf(UnsentValidationError);
    expect(m.calls).toHaveLength(0);
  });

  it('iterate() walks every page, oldest first, and stops', async () => {
    const all = Array.from({ length: 5 }, (_, i) => listRow({ id: i + 1 }));
    const { m, unsent } = setup((req) => {
      const off = Number(req.url.searchParams.get('offset') ?? 0);
      const lim = Number(req.url.searchParams.get('limit') ?? 100);
      return json({ emails: all.slice(off, off + lim), total: all.length, limit: lim, offset: off });
    });
    const ids: number[] = [];
    for await (const e of unsent.emails.iterate({ limit: 2 })) ids.push(e.id);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(m.calls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '2', '4']);
    expect(m.calls[0]!.url.searchParams.get('sort')).toBe('created_at_asc');
  });

  it('iterate() ends on an empty collection and on a server that over-reports total', async () => {
    const { unsent } = setup(() => json({ emails: [], total: 10, limit: 100, offset: 0 }));
    const out: unknown[] = [];
    for await (const e of unsent.emails.iterate()) out.push(e);
    expect(out).toEqual([]);
  });
});

describe('emails.wait', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const realSetTimeout = globalThis.setTimeout;
  const pumpUntil = async (p: Promise<unknown>) => {
    let done = false;
    const g = p.then(
      (v) => ((done = true), { v }),
      (e) => ((done = true), { e }),
    );
    for (let i = 0; i < 500 && !done; i++) {
      await vi.advanceTimersByTimeAsync(500);
      await new Promise((r) => realSetTimeout(r, 1));
    }
    const r: any = await g;
    if ('e' in r) throw r.e;
    return r.v;
  };

  it('polls until sent', async () => {
    const seq = ['queued', 'sending', 'sent'];
    const { m, unsent } = setup((_r, n) => json({ email: listRow({ status: seq[n - 1] }) }));
    const e = await pumpUntil(unsent.emails.wait(3));
    expect(e.status).toBe('sent');
    expect(m.calls).toHaveLength(3);
  });

  it('keeps waiting on a failed email that still has retries left, and returns once attempts are exhausted', async () => {
    const seq = [
      { status: 'failed', attempts: 1 },
      { status: 'failed', attempts: 2 },
      { status: 'failed', attempts: MAX_DELIVERY_ATTEMPTS },
    ];
    const { m, unsent } = setup((_r, n) => json({ email: listRow({ ...seq[n - 1], error: 'boom' }) }));
    const e = await pumpUntil(unsent.emails.wait(3));
    expect(e).toMatchObject({ status: 'failed', attempts: 3, error: 'boom' });
    expect(m.calls).toHaveLength(3);
  });

  it('times out with UnsentTimeoutError', async () => {
    const { unsent } = setup(() => json({ email: listRow({ status: 'queued', attempts: 0 }) }));
    const err = await pumpUntil(unsent.emails.wait(3, { timeoutMs: 3000 })).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentTimeoutError);
    expect(err.message).toMatch(/Email 3.*queued.*3000/);
  });

  it('can be aborted', async () => {
    const ac = new AbortController();
    const { unsent } = setup(() => json({ email: listRow({ status: 'queued', attempts: 0 }) }));
    const p = unsent.emails.wait(3, { signal: ac.signal }).catch((e) => e);
    await new Promise((r) => realSetTimeout(r, 20));
    ac.abort();
    expect((await p).code).toBe('aborted');
  });

  it('propagates lookup errors (e.g. 404)', async () => {
    const { unsent } = setup(() => apiError(404, 'not_found', 'Email not found'));
    await expect(unsent.emails.wait(3)).rejects.toBeInstanceOf(UnsentNotFoundError);
  });
});

describe('status and health', () => {
  it('status() returns counters with defaults', async () => {
    const { m, unsent } = setup(() => json({ queued: 1, sending: 2, sent: 3, failed: 4 }));
    expect(await unsent.status()).toEqual({ queued: 1, sending: 2, sent: 3, failed: 4 });
    expect(m.calls[0]!.url.pathname).toBe('/api/status');
    expect(m.calls[0]!.headers.get('X-API-Key')).toBe(API_KEY);
  });

  it('health() needs no credentials', async () => {
    const { m, unsent } = setup(() => json({ status: 'ok', runtime: 'cf_worker', d1: 'bound', timestamp: 1780000000000 }));
    expect(await unsent.health()).toEqual({ status: 'ok', runtime: 'cf_worker', d1: 'bound', timestamp: new Date(1780000000000) });
    expect(m.calls[0]!.headers.has('X-API-Key')).toBe(false);
  });

  it('status() rejects bad credentials with a hint', async () => {
    const { unsent } = setup(() => apiError(401, 'invalid_api_key', 'Unauthorized: Invalid credentials or expired session'));
    await expect(unsent.status()).rejects.toMatchObject({ status: 401, code: 'invalid_api_key', hint: expect.stringMatching(/API_KEY/) });
  });
});

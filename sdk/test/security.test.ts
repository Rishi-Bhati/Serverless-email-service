/**
 * Security properties of the SDK that need no live server: credential non-disclosure, request targeting
 * (no caller-controlled paths, no redirects, https only), header-injection resistance and email-header hygiene.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Unsent, UnsentConfigError, UnsentError, UnsentValidationError } from '../src';
import { accepted, json, mockFetch } from './helpers';

const KEY = 'sk_live_TOPSECRET_KEY_123456';
const SECRET = 'whsec_TOPSECRET_SECRET_abcdef';
const BASE = 'https://unsent.test';
const msg = { to: 'a@b.co', subject: 's', text: 't' };

function dump(v: unknown): string {
  let s = '';
  try {
    s += JSON.stringify(v);
  } catch {
    /* cyclic */
  }
  s += inspect(v, { depth: Infinity, showHidden: true, getters: true });
  s += String(v);
  if (v instanceof Error) {
    for (let e: unknown = v; e; e = (e as { cause?: unknown }).cause) s += inspect(e, { depth: Infinity, showHidden: true }) + String((e as Error).stack);
    s += Object.getOwnPropertyNames(v).map((k) => String((v as unknown as Record<string, unknown>)[k])).join('|');
  }
  return s;
}

function expectNoSecrets(v: unknown) {
  const s = dump(v);
  expect(s).not.toContain(KEY);
  expect(s).not.toContain(SECRET);
}

const client = (fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) =>
  new Unsent({ baseUrl: BASE, apiKey: KEY, apiSecret: SECRET, fetch: fetchImpl, maxRetries: 0, ...extra });

afterEach(() => vi.restoreAllMocks());

describe('credential non-disclosure', () => {
  it('client, emails namespace and their JSON/inspect forms contain no credentials', () => {
    const u = client(mockFetch(() => accepted()).fetch);
    expectNoSecrets(u);
    expectNoSecrets(u.emails);
    expect(Object.keys(u)).toEqual(['emails']);
    expect(JSON.stringify(u)).toBe('{}');
  });

  it('errors of every kind carry no credentials, including their cause chains', async () => {
    const failures: Array<() => Response | Promise<Response>> = [
      () => json({ error: 'Unauthorized', code: 'invalid_signature', reason: 'bad' }, 401),
      () => json({ error: 'Forbidden', code: 'forbidden' }, 403),
      () => json({ error: 'Not Found', code: 'not_found' }, 404),
      () => json({ error: 'conflict', code: 'idempotency_key_conflict', id: 3 }, 409),
      () => json({ error: 'too big', code: 'payload_too_large' }, 413),
      () => json({ error: 'slow down', code: 'rate_limited' }, 429, { 'Retry-After': '1' }),
      () => json({ error: 'Internal', code: 'internal_error' }, 500),
      () => new Response('<html>bad gateway</html>', { status: 502 }),
      () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } }),
      () => new Response('not json', { status: 200 }),
      () => new Response('x', { status: 200, headers: { 'Content-Length': String(64 * 1024 * 1024) } }),
      () => {
        throw new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
      },
    ];
    for (const f of failures) {
      const err = await client(mockFetch(f).fetch).send(msg).catch((e) => e);
      expect(err).toBeInstanceOf(UnsentError);
      expectNoSecrets(err);
    }
  });

  it('a real connection failure (refused port) does not leak credentials through undici causes', async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as AddressInfo).port;
    await new Promise<void>((r) => srv.close(() => r()));
    const u = new Unsent({ baseUrl: `http://127.0.0.1:${port}`, apiKey: KEY, apiSecret: SECRET, maxRetries: 0 });
    const err = await u.send(msg).catch((e) => e);
    expect(err.code).toBe('connection_error');
    expectNoSecrets(err);
  });

  it('timeouts and aborts carry no credentials', async () => {
    const hang = mockFetch(() => new Promise<Response>(() => {})).fetch;
    const t = await client(hang, { timeoutMs: 20 }).send(msg).catch((e) => e);
    expect(t.code).toBe('timeout');
    expectNoSecrets(t);
    const ac = new AbortController();
    const p = client(hang).send({ ...msg, signal: ac.signal });
    ac.abort(new Error('user'));
    const a = await p.catch((e) => e);
    expect(a.code).toBe('aborted');
    expectNoSecrets(a);
  });

  it('redacts credentials that a hostile server echoes back in error bodies, reasons, status text and Location', async () => {
    const echo = (status: number, extra: Record<string, string> = {}) =>
      mockFetch(
        (req) =>
          new Response(
            JSON.stringify({ error: `bad key ${req.headers.get('X-API-Key')}`, code: 'x', reason: `secret=${SECRET}`, nested: { k: KEY } }),
            { status, statusText: `st ${KEY}`, headers: { 'Content-Type': 'application/json', ...extra } },
          ),
      ).fetch;
    for (const status of [400, 401, 500]) {
      const err = await client(echo(status)).send(msg).catch((e) => e);
      expect(err.message).toContain('[REDACTED]');
      expectNoSecrets(err);
    }
    const text = mockFetch(() => new Response(`proxy error, key was ${KEY}`, { status: 502 })).fetch;
    expectNoSecrets(await client(text).status().catch((e) => e));
    const redirect = mockFetch(() => new Response(null, { status: 307, headers: { Location: `https://evil.test/?k=${KEY}` } })).fetch;
    const r = await client(redirect).status().catch((e) => e);
    expect(r.code).toBe('unexpected_redirect');
    expectNoSecrets(r);
    // JSON-escaped spelling of a secret with quotes/backslashes is redacted too.
    const odd = 'odd"secret\\value!!';
    const u = new Unsent({ baseUrl: BASE, apiKey: KEY, apiSecret: odd, maxRetries: 0, fetch: mockFetch(() => json({ error: `got ${odd}`, code: 'x' }, 400)).fetch });
    const e2 = await u.send(msg).catch((e) => e);
    expect(dump(e2)).not.toContain(odd);
    expect(JSON.stringify(e2.body)).not.toContain(JSON.stringify(odd).slice(1, -1));
  });

  it('writes nothing to the console, ever', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const u = client(mockFetch((_r, n) => (n % 2 ? json({ error: 'x', code: 'internal_error' }, 500) : accepted())).fetch, { maxRetries: 1 });
    await Promise.allSettled([u.send(msg), u.status(), u.health(), u.emails.get(1), u.emails.list()]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('apiKey / apiSecret validation at construction', () => {
  const bad = ['key\nX-Evil: 1', 'key\r\nX', 'ke\0y', 'k\x7fey', 'k\tey', 'kéy', 'key🔑', 'key\u2028x', 'key\u0085x', 'key x'];
  it.each(bad)('rejects apiKey %j without echoing it', (apiKey) => {
    let err: unknown;
    try {
      new Unsent({ baseUrl: BASE, apiKey, fetch: mockFetch(() => accepted()).fetch });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsentConfigError);
    expect((err as UnsentConfigError).code).toBe('invalid_api_key');
    expect((err as Error).message).not.toContain(apiKey.trim());
  });

  it('rejects the same values from the environment', () => {
    vi.stubEnv('UNSENT_API_KEY', 'abc\ndef');
    vi.stubEnv('UNSENT_BASE_URL', BASE);
    expect(() => new Unsent({ fetch: mockFetch(() => accepted()).fetch })).toThrow(UnsentConfigError);
    vi.unstubAllEnvs();
  });

  it('accepts every printable ASCII character and trims surrounding whitespace', async () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(0x20 + i)).join('').trim();
    const m = mockFetch(() => accepted());
    await new Unsent({ baseUrl: BASE, apiKey: ` ${printable}\n`, fetch: m.fetch }).send(msg);
    expect(m.calls[0]!.headers.get('X-API-Key')).toBe(printable);
  });

  it('rejects non-string credentials and base URLs with a config error', () => {
    for (const v of [5, {}, [], true, Symbol('x'), 10n, () => 'x']) {
      expect(() => new Unsent({ baseUrl: v as never, apiKey: 'k' })).toThrow(UnsentConfigError);
      expect(() => new Unsent({ baseUrl: BASE, apiKey: v as never })).toThrow(UnsentConfigError);
      expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', apiSecret: v as never })).toThrow(UnsentConfigError);
    }
  });
});

describe('request targeting', () => {
  it('ignores unknown request options: a caller cannot change path, method, body, auth or query', async () => {
    const m = mockFetch((req) =>
      req.url.pathname === '/api/send'
        ? accepted()
        : json({ emails: [], total: 0, limit: 1, offset: 0, email: { id: 1 }, status: 'ok', queued: 0 }),
    );
    const u = client(m.fetch);
    const evil = {
      path: '@evil.example/steal',
      method: 'POST',
      body: { x: 1 },
      auth: true,
      sign: false,
      query: { a: 'b' },
      retrySafe: true,
      deadline: 0,
    } as never;
    await u.emails.list(evil);
    await u.emails.get(1, evil);
    await u.status(evil);
    await u.health(evil);
    await u.send({ ...msg, ...(evil as object) });
    for (const c of m.calls) {
      expect(c.url.origin).toBe(BASE);
      expect(c.url.searchParams.has('a')).toBe(false);
    }
    expect(m.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      'GET /api/emails',
      'GET /api/emails/1',
      'GET /api/status',
      'GET /api/health',
      'POST /api/send',
    ]);
    expect(m.calls[3]!.headers.has('X-API-Key')).toBe(false); // health stays unauthenticated
  });

  it('every request goes to the configured origin and keeps the path prefix', async () => {
    const m = mockFetch(() => json({ emails: [], total: 0, limit: 1, offset: 0 }));
    const u = new Unsent({ baseUrl: 'https://unsent.test/prefix/', apiKey: KEY, fetch: m.fetch });
    await u.emails.list({ search: '../../../@evil.example/?#' });
    expect(m.calls[0]!.url.origin).toBe('https://unsent.test');
    expect(m.calls[0]!.url.pathname).toBe('/prefix/api/emails');
    expect(m.calls[0]!.url.searchParams.get('q')).toBe('../../../@evil.example/?#');
  });

  it.each([
    'http://unsent.example.com',
    'http://localhost.evil.test',
    'http://127.0.0.1.nip.io',
    'http://[::ffff:127.0.0.1]',
    'http://localhost.',
    'http://10.0.0.1',
    'ftp://unsent.test',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,hi',
    'ws://localhost',
    'https://user:pass@unsent.test',
    'https://:pass@unsent.test',
    'https://user@unsent.test',
    '//unsent.test',
    'unsent.test',
    '',
    ' ',
  ])('rejects baseUrl %j', (baseUrl) => {
    expect(() => new Unsent({ baseUrl, apiKey: 'k', fetch: mockFetch(() => accepted()).fetch })).toThrow(UnsentConfigError);
  });

  it.each(['http://localhost:1', 'http://LOCALHOST:1', 'http://127.0.0.1', 'http://127.1:8', 'http://[::1]:9', 'http://dev.localhost', 'https://10.0.0.1'])(
    'allows %j',
    (baseUrl) => {
      expect(() => new Unsent({ baseUrl, apiKey: 'k', fetch: mockFetch(() => accepted()).fetch })).not.toThrow();
    },
  );

  it.each([300, 301, 302, 303, 304, 307, 308])('refuses a %i redirect without following it (mock fetch)', async (status) => {
    const m = mockFetch(() => new Response(null, { status, headers: { Location: 'https://evil.test/collect' } }));
    const err = await client(m.fetch, { maxRetries: 3 }).send(msg).catch((e) => e);
    expect(err.code).toBe('unexpected_redirect');
    expect(m.calls).toHaveLength(1);
  });

  describe('against a real redirecting server (global fetch)', () => {
    let srv: Server;
    let evil: Server;
    let evilHits = 0;
    let base = '';
    beforeAll(async () => {
      evil = createServer((_req, res) => {
        evilHits++;
        res.end('{}');
      });
      await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
      const evilPort = (evil.address() as AddressInfo).port;
      srv = createServer((req, res) => {
        res.writeHead(Number(req.url!.split('code=')[1] ?? 302) || 302, { Location: `http://127.0.0.1:${evilPort}/steal` });
        res.end();
      });
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    });
    afterAll(async () => {
      await new Promise((r) => srv.close(r));
      await new Promise((r) => evil.close(r));
    });

    it('never contacts the redirect target', async () => {
      const u = new Unsent({ baseUrl: base, apiKey: KEY, apiSecret: SECRET, maxRetries: 2 });
      for (const fn of [() => u.send(msg), () => u.status(), () => u.emails.get(1), () => u.emails.list(), () => u.health()]) {
        const err = await fn().catch((e) => e);
        expect(err.code).toBe('unexpected_redirect');
      }
      expect(evilHits).toBe(0);
    });
  });
});

describe('header and email-header injection (rejected before any network I/O)', () => {
  const m = mockFetch(() => accepted());
  const u = client(m.fetch);
  const rejects = async (o: Record<string, unknown>) => {
    const before = m.calls.length;
    const err = await u.send({ ...msg, ...o } as never).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentValidationError);
    expect(m.calls.length).toBe(before);
    return err;
  };

  it.each(['\r', '\n', '\r\n', '\0', '\u2028', '\u2029', '\u0085', ' ', '\t', ',', ';', '<', '>', '"', '(', ')', '[', ']', '\\', '\x7f', '\x01'])(
    'rejects %j inside recipient addresses (to/cc/bcc) and from email',
    async (ch) => {
      const addr = `vic${ch}tim@example.com`;
      await rejects({ to: addr });
      await rejects({ to: ['ok@example.com', addr] });
      await rejects({ cc: addr });
      await rejects({ bcc: [addr] });
      await rejects({ from: { email: addr } });
    },
  );

  it('rejects comma-joined recipient lists, which would bypass the 100-recipient limit', async () => {
    const many = Array.from({ length: 150 }, (_, i) => `r${i}@example.com`).join(',');
    await rejects({ to: [many] });
    await rejects({ bcc: 'a@x.co, b@y.co' });
  });

  it('rejects addresses without exactly one @ and overlong addresses', async () => {
    for (const a of ['plain', '@x.co', 'a@', 'a@@b.co', 'a@b@c.co', `${'a'.repeat(310)}@example.com`]) await rejects({ to: a });
  });

  it.each(['"', '\\', '<', '>', '\r', '\n', '\0', '\u2028', '\x1b'])('rejects %j in the sender display name', async (ch) => {
    await rejects({ from: { email: 'me@x.co', name: `Evil${ch}Name` } });
    if (ch !== '<' && ch !== '>' && ch !== '"') await rejects({ from: `Evil${ch}Name <me@x.co>` });
  });

  it('display-name spoofing payloads are rejected', async () => {
    await rejects({ from: { email: 'me@x.co', name: 'x" <ceo@corp.example>, "y' } });
    await rejects({ from: '"CEO" <ceo@corp.example>" <me@x.co>' });
    await rejects({ from: 'a <b> <me@x.co>' });
  });

  it('still parses ordinary display names', async () => {
    const mm = mockFetch(() => accepted());
    const uu = client(mm.fetch);
    await uu.send({ ...msg, from: '"Ünïcødé Sender, Inc." <me@x.co>' });
    await uu.send({ ...msg, from: "O'Brien & Sons <me@x.co>" });
    await uu.send({ ...msg, from: '  <me@x.co>  ' });
    expect(mm.calls.map((c) => c.json.from)).toEqual([
      { email: 'me@x.co', name: 'Ünïcødé Sender, Inc.' },
      { email: 'me@x.co', name: "O'Brien & Sons" },
      { email: 'me@x.co' },
    ]);
  });

  it.each(['a"b.pdf', 'a\\b.pdf', 'a\r\nContent-Type: text/html.pdf', 'a\0.pdf', 'tab\t.pdf', 'a\u2028b.pdf', 'x.pdf"; filename*=UTF-8\'\'evil.exe; x="'])(
    'rejects attachment filename %j',
    async (filename) => {
      await rejects({ attachments: [{ filename, content: 'aGk=' }] });
    },
  );

  it.each([
    'text/plain\r\nX-Evil: 1',
    'text/plain"',
    'text/html; name="evil.exe"',
    'text',
    '/plain',
    'text/plain;',
    'text/plain; charset',
    `application/${'x'.repeat(130)}`,
    'text/pl\u2028ain',
    'text/plain;\u0000a=b',
  ])('rejects mime type %j', async (contentType) => {
    await rejects({ attachments: [{ filename: 'a.txt', content: 'aGk=', contentType }] });
    await rejects({ attachments: [{ filename: 'a.txt', content: 'aGk=', mimeType: contentType }] });
  });

  it('accepts ordinary MIME types, including parameters', async () => {
    const mm = mockFetch(() => accepted());
    const uu = client(mm.fetch);
    for (const t of ['application/pdf', 'text/plain; charset=utf-8', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/svg+xml']) {
      await uu.send({ ...msg, attachments: [{ filename: 'a.bin', content: 'aGk=', contentType: t }] });
    }
    expect(mm.calls).toHaveLength(4);
  });

  it('rejects control characters in providerId and non-ASCII/space idempotency keys', async () => {
    await rejects({ providerId: 'p\r\n1' });
    for (const k of ['a b', 'kéy', 'a\nb', '', ' ', 'x'.repeat(256), 'tab\tkey']) {
      const err = await rejects({ idempotencyKey: k });
      expect(err.code).toBe('invalid_idempotency_key');
    }
  });

  it('only the validated apiKey and SDK-generated values ever reach HTTP headers', async () => {
    const mm = mockFetch(() => accepted());
    await client(mm.fetch).send({
      to: 'a@b.co',
      subject: 'X-Injected: 1\r\nBcc: evil@x.co',
      html: '<p>\r\nX-Injected: yes</p>',
      idempotencyKey: 'order:1/2?3#4',
      providerId: 'p1',
      from: { email: 'me@x.co', name: 'Me' },
    });
    const names = [...mm.calls[0]!.headers.keys()].sort();
    expect(names).toEqual(['accept', 'content-type', 'user-agent', 'x-api-key', 'x-nonce', 'x-signature', 'x-timestamp']);
    for (const [, v] of mm.calls[0]!.headers) expect(v).toMatch(/^[\x20-\x7e]+$/);
  });
});

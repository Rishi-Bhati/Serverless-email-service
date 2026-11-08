/**
 * A hostile or broken server, over real sockets (node:http / node:net on ephemeral loopback ports) and the
 * runtime's real fetch: oversize and never-ending bodies, slowloris, resets, garbage, redirect loops.
 * The SDK must answer with a typed error within its timeout and never buffer unbounded data.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Unsent, UnsentError } from '../src';
import { json, mockFetch } from './helpers';

type Route = (req: IncomingMessage, res: ServerResponse) => void;
let route: Route = (_q, s) => s.end('{}');
let hits = 0;
const sockets = new Set<Socket>();
const server = createServer((req, res) => {
  hits++;
  route(req, res);
});
server.on('connection', (s) => {
  sockets.add(s);
  s.on('close', () => sockets.delete(s));
});
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  hits = 0;
  for (const s of sockets) s.destroy();
});
afterAll(async () => {
  for (const s of sockets) s.destroy();
  await new Promise((r) => server.close(r));
});

const client = (extra: Record<string, unknown> = {}) => new Unsent({ baseUrl: base, apiKey: 'test-key-123456', apiSecret: 's', maxRetries: 0, timeoutMs: 1500, ...extra });
const msg = { to: 'a@b.co', subject: 's', text: 't' };

async function outcome(p: Promise<unknown>) {
  const t = performance.now();
  const r = await p.then(
    (v) => ({ v, e: undefined as unknown }),
    (e) => ({ v: undefined, e }),
  );
  return { ...r, ms: performance.now() - t };
}

describe('oversize responses', () => {
  it('refuses an announced Content-Length over 32 MiB without reading it', async () => {
    route = (_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(40 * 1024 * 1024) });
      res.write('{"x":'); // then hang
    };
    const r = await outcome(client().status());
    expect(r.e).toBeInstanceOf(UnsentError);
    expect((r.e as UnsentError).code).toBe('response_too_large');
    expect(r.ms).toBeLessThan(1000);
  });

  it('stops reading a chunked body once it passes 32 MiB', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    let sent = 0;
    route = (_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const pump = () => {
        while (sent < 200 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
        if (sent < 200 * 1024 * 1024) res.once('drain', pump);
      };
      pump();
    };
    const before = process.memoryUsage().heapUsed;
    const r = await outcome(client({ timeoutMs: 20_000 }).emails.list());
    expect((r.e as UnsentError).code).toBe('response_too_large');
    expect(sent).toBeLessThan(120 * 1024 * 1024); // the server was not drained to the end
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(150 * 1024 * 1024);
  }, 30_000);

  it('an error body over 32 MiB is refused too', async () => {
    route = (_q, res) => {
      res.writeHead(500, { 'Content-Length': String(33 * 1024 * 1024) });
      res.write('x');
    };
    expect(((await outcome(client().send(msg))).e as UnsentError).code).toBe('response_too_large');
  });
});

describe('hangs and slowloris', () => {
  it('a server that never answers hits the timeout', async () => {
    route = () => {};
    const r = await outcome(client({ timeoutMs: 400 }).status());
    expect((r.e as UnsentError).code).toBe('timeout');
    expect(r.ms).toBeGreaterThanOrEqual(350);
    expect(r.ms).toBeLessThan(1500);
  });

  it('headers sent, body never finishes: the timeout covers the body too', async () => {
    route = (_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"queued":');
    };
    const r = await outcome(client({ timeoutMs: 400 }).status());
    expect((r.e as UnsentError).code).toBe('timeout');
    expect(r.ms).toBeLessThan(1500);
  });

  it('a body trickled one byte at a time cannot outlast the timeout', async () => {
    route = (_q, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const t = setInterval(() => (res.destroyed ? clearInterval(t) : res.write(' ')), 50);
      res.on('close', () => clearInterval(t));
    };
    const r = await outcome(client({ timeoutMs: 500 }).status());
    expect((r.e as UnsentError).code).toBe('timeout');
    expect(r.ms).toBeLessThan(1500);
  });

  it('a hung body is retried as a timeout for GETs (bounded by maxRetries)', async () => {
    route = (_q, res) => {
      res.writeHead(200);
      res.write('{');
    };
    const r = await outcome(client({ timeoutMs: 200, maxRetries: 2 }).status());
    expect((r.e as UnsentError).code).toBe('timeout');
    expect(hits).toBe(3);
  });

  it('the user can abort while the body is being read', async () => {
    route = (_q, res) => {
      res.writeHead(200);
      res.write('{');
    };
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const r = await outcome(client({ timeoutMs: 10_000 }).status({ signal: ac.signal }));
    expect((r.e as UnsentError).code).toBe('aborted');
    expect(r.ms).toBeLessThan(1000);
  });
});

describe('broken and malicious responses', () => {
  it('connection reset mid-body is a retryable connection error', async () => {
    route = (_q, res) => {
      res.writeHead(200, { 'Content-Length': '100' });
      res.write('{"queued"');
      setTimeout(() => res.socket?.destroy(), 20);
    };
    const r = await outcome(client({ maxRetries: 1 }).status());
    expect((r.e as UnsentError).code).toBe('connection_error');
    expect(hits).toBe(2);
  });

  it('a redirect loop is refused on the first hop', async () => {
    route = (_q, res) => {
      res.writeHead(302, { Location: '/api/status' });
      res.end();
    };
    const r = await outcome(client({ maxRetries: 3 }).status());
    expect((r.e as UnsentError).code).toBe('unexpected_redirect');
    expect(hits).toBe(1);
  });

  it.each([
    ['garbage', 'not json at all', 200],
    ['truncated json', '{"id": 1,', 202],
    ['html error page', '<html><body>502</body></html>', 502],
    ['__proto__ payload', '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"queued":1}', 200],
    ['binary', '\u0000\u0001ÿ�', 200],
  ] as const)('%s → typed error or safe value', async (_n, body, status) => {
    route = (_q, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body);
    };
    for (const call of [() => client().status(), () => client().send(msg), () => client().emails.list()]) {
      const r = await outcome(call());
      if (r.e) expect(r.e).toBeInstanceOf(UnsentError);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  describe('raw TCP: invalid HTTP', () => {
    let tcp: TcpServer;
    let tcpBase = '';
    let reply: (s: Socket) => void = () => {};
    beforeAll(async () => {
      tcp = createTcpServer((s) => {
        s.on('error', () => {});
        s.once('data', () => reply(s));
      });
      await new Promise<void>((r) => tcp.listen(0, '127.0.0.1', r));
      tcpBase = `http://127.0.0.1:${(tcp.address() as AddressInfo).port}`;
    });
    afterAll(() => new Promise((r) => tcp.close(r)));

    it.each([
      ['garbage status line', (s: Socket) => s.end('garbage\r\n\r\n')],
      ['status 999', (s: Socket) => s.end('HTTP/1.1 999 Nope\r\nContent-Length: 2\r\n\r\n{}')],
      ['header without colon', (s: Socket) => s.end('HTTP/1.1 200 OK\r\nBroken header\r\n\r\n{}')],
      ['immediate close', (s: Socket) => s.destroy()],
      ['content-length lies (short)', (s: Socket) => s.end('HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\n{}')],
      ['negative content-length', (s: Socket) => s.end('HTTP/1.1 200 OK\r\nContent-Length: -5\r\n\r\n{}')],
      ['bad chunk encoding', (s: Socket) => s.end('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n{}\r\n0\r\n\r\n')],
      ['header flood', (s: Socket) => s.end('HTTP/1.1 200 OK\r\n' + 'X-A: b\r\n'.repeat(20000) + '\r\n{}')],
    ])('%s → typed error', async (_n, fn) => {
      reply = fn;
      const u = new Unsent({ baseUrl: tcpBase, apiKey: 'k', maxRetries: 0, timeoutMs: 2000 });
      const r = await outcome(u.status());
      expect(r.e).toBeInstanceOf(UnsentError);
      expect(r.ms).toBeLessThan(2500);
    });
  });
});

describe('absurd Retry-After / Date headers (mock fetch, fake timers)', () => {
  afterEach(() => vi.useRealTimers());

  it('Retry-After is capped at 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = mockFetch((_r, n) => (n === 1 ? json({ error: 'busy', code: 'rate_limited' }, 429, { 'Retry-After': '99999999999' }) : json({ queued: 0 })));
    const u = new Unsent({ baseUrl: 'https://unsent.test', apiKey: 'k', fetch: m.fetch, maxRetries: 1 });
    const p = u.status();
    for (let i = 0; i < 70 && m.calls.length < 2; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }
    await p;
    expect(m.calls).toHaveLength(2);
  });

  it('an implausible Date header does not poison the clock offset', async () => {
    const seen: string[] = [];
    const m = mockFetch((req) => {
      if (req.url.pathname === '/api/send') seen.push(req.headers.get('X-Timestamp') ?? '');
      return json({ error: 'Unauthorized', code: 'timestamp_skew' }, 401, { Date: 'Sat, 01 Jan 275760 00:00:00 GMT' });
    });
    const u = new Unsent({ baseUrl: 'https://unsent.test', apiKey: 'k', apiSecret: 's', fetch: m.fetch, maxRetries: 0 });
    await u.send(msg).catch(() => {});
    await u.send(msg).catch(() => {});
    for (const ts of seen) expect(Math.abs(Number(ts) - Date.now() / 1000)).toBeLessThan(5);
  });
});

/**
 * ReDoS / complexity checks on every regex and string loop, and seeded-random fuzzing of every public method.
 * Invariant: the SDK only ever rejects with its own `UnsentError` subclasses, always settles quickly, never leaves
 * an unhandled rejection and never touches Object.prototype.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Emails, Unsent, UnsentError } from '../src';
import { attachmentFromFile } from '../src/node';
import { accepted, json, mockFetch } from './helpers';

const BASE = 'https://unsent.test';
const LIMIT_MS = 250;
const timings: Array<[string, number]> = [];

function okFetch() {
  return mockFetch((req) => {
    if (req.url.pathname === '/api/send') return accepted(7);
    if (req.url.pathname === '/api/emails') return json({ emails: [{ id: 1, status: 'sent', attachments: [{ content: '='.repeat(10) }] }], total: 1, limit: 1, offset: 0 });
    if (req.url.pathname.startsWith('/api/emails/')) return json({ email: { id: 1, status: 'sent', attempts: 1 } });
    if (req.url.pathname === '/api/status') return json({ queued: 1, sending: 0, sent: 0, failed: 0 });
    return json({ status: 'ok', timestamp: Date.now() });
  }).fetch;
}
const client = () => new Unsent({ baseUrl: BASE, apiKey: 'k', apiSecret: 's', fetch: okFetch(), maxRetries: 0 });

async function timed(name: string, fn: () => unknown): Promise<number> {
  const t = performance.now();
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof UnsentError)) throw e;
  }
  const ms = performance.now() - t;
  timings.push([name, Math.round(ms * 10) / 10]);
  return ms;
}

describe('ReDoS and algorithmic complexity (pathological 100k-1M char inputs)', () => {
  const N = 100_000;
  const u = client();
  const msg = { to: 'a@b.co', subject: 's', text: 't' };
  const cases: Array<[string, () => unknown]> = [
    // parseAddress (previously /^\s*"?([^"<>]*?)"?\s*<\s*([^<>\s]+)\s*>\s*$/: cubic, 10k spaces > 2 min)
    ['from: spaces', () => u.send({ ...msg, from: ' '.repeat(N) + 'x' })],
    ['from: spaces then <', () => u.send({ ...msg, from: ' '.repeat(N) + '<' })],
    ['from: name + spaces + <a', () => u.send({ ...msg, from: 'a' + ' '.repeat(N) + '<a' + ' '.repeat(N) })],
    ['from: <<<<…>', () => u.send({ ...msg, from: '<'.repeat(N) + '>' })],
    ['from: quotes', () => u.send({ ...msg, from: '"'.repeat(N) + '<a@b.co>' })],
    ['from: long valid name', () => u.send({ ...msg, from: 'n'.repeat(N) + ' <a@b.co>' })],
    ['from object: huge name', () => u.send({ ...msg, from: { email: 'a@b.co', name: ' '.repeat(N) + '"' } })],
    // mailbox validation
    ['to: long local part', () => u.send({ ...msg, to: 'a'.repeat(N) + '@' })],
    ['to: many @', () => u.send({ ...msg, to: '@'.repeat(N) })],
    ['to: a@ repeated', () => u.send({ ...msg, to: 'a@'.repeat(N / 2) })],
    ['to: 100 long addresses', () => u.send({ ...msg, to: Array.from({ length: 100 }, () => 'a'.repeat(N / 100) + '@b.co') })],
    // attachments
    ['b64: 1M chars + !', () => u.send({ ...msg, attachments: [{ filename: 'a', content: 'A'.repeat(1_000_000) + '!' }] })],
    ['b64: whitespace-laden 2M', () => u.send({ ...msg, attachments: [{ filename: 'a', content: ' A\n'.repeat(700_000) }] })],
    ['b64: = run', () => u.send({ ...msg, attachments: [{ filename: 'a', content: '='.repeat(N) + 'A' }] })],
    ['filename: 100k quotes', () => u.send({ ...msg, attachments: [{ filename: '"'.repeat(N), content: 'aGk=' }] })],
    ['mime: 100k', () => u.send({ ...msg, attachments: [{ filename: 'a', content: 'aGk=', contentType: 'a/' + 'a;a=a'.repeat(N / 5) }] })],
    ['mime: 127 params', () => u.send({ ...msg, attachments: [{ filename: 'a', content: 'aGk=', contentType: 'a/b' + ';a=b'.repeat(31) + ';' }] })],
    ['encode 2.2MB bytes', () => u.send({ ...msg, attachments: [{ filename: 'a', content: new Uint8Array(2_200_000) }] })],
    // other fields
    ['idempotencyKey 1M', () => u.send({ ...msg, idempotencyKey: '!'.repeat(1_000_000) })],
    ['providerId 1M', () => u.send({ ...msg, providerId: 'p'.repeat(1_000_000) })],
    ['subject 1M', () => u.send({ ...msg, subject: 's'.repeat(1_000_000) })],
    ['text-only escape 1M', () => u.send({ ...msg, text: '<&>"\''.repeat(200_000) })],
    ['sign 2.9MB html', () => u.send({ ...msg, html: '€'.repeat(950_000) })],
    ['list: date junk', () => u.emails.list({ from: '2024-01-01' + 'T'.repeat(N) })],
    ['list: search 1M', () => u.emails.list({ search: '%'.repeat(1_000_000) })],
    // URL normalisation (previously /\/+$/: quadratic)
    ['baseUrl: slashes then x', () => new Unsent({ baseUrl: 'https://a.test/' + '/'.repeat(N) + 'x', apiKey: 'k' })],
    ['baseUrl: trailing slashes', () => new Unsent({ baseUrl: 'https://a.test/' + '/'.repeat(N), apiKey: 'k' })],
    ['apiKey 1M', () => new Unsent({ baseUrl: BASE, apiKey: 'k'.repeat(1_000_000) + '\n' })],
  ];

  it.each(cases)('%s finishes quickly', async (name, fn) => {
    const ms = await timed(name, fn);
    expect(ms).toBeLessThan(name.startsWith('encode') || name.startsWith('sign') || name.startsWith('b64') ? 1000 : LIMIT_MS);
  });

  it('response mapping: base64 size of a 1M "=" run and huge failover history', async () => {
    const big = new Unsent({
      baseUrl: BASE,
      apiKey: 'k',
      maxRetries: 0,
      fetch: async () =>
        json({
          email: { id: 1, attachments: [{ content: '='.repeat(1_000_000) + 'x' }], failover_history: JSON.stringify(Array.from({ length: 50_000 }, () => ({ provider: 'p' }))) },
          emails: Array.from({ length: 200 }, () => ({ id: 1, attachments: [{ content: '='.repeat(5000) + 'x' }] })),
          total: 1,
        }),
    });
    expect(await timed('map: get with = run', () => big.emails.get(1))).toBeLessThan(LIMIT_MS * 2);
    expect(await timed('map: list 200 x = run', () => big.emails.list())).toBeLessThan(LIMIT_MS * 2);
  });

  afterAll(() => {
    // Measured timings, for the report.
    console.log('ReDoS timings (ms):\n' + timings.map(([n, t]) => `  ${t.toString().padStart(7)}  ${n}`).join('\n'));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Seeded fuzzing

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

const boom = () => {
  throw new RangeError('boom');
};

function hostileObject(r: Rng): unknown {
  switch (Math.floor(r() * 9)) {
    case 0:
      return new Proxy({}, { get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom, getPrototypeOf: boom });
    case 1:
      return new Proxy([], { get: boom });
    case 2:
      return { toString: boom, valueOf: boom, [Symbol.toPrimitive]: boom };
    case 3:
      return Object.defineProperty({}, 'email', { get: boom, enumerable: true });
    case 4: {
      const o: Record<string, unknown> = { a: 1 };
      o.self = o;
      return o;
    }
    case 5:
      return Object.create(null);
    case 6:
      return { toString: null, valueOf: null };
    case 7:
      return new Proxy(['a@b.co'], { get: (t, k) => (k === 'length' ? 1e9 : Reflect.get(t, k)) });
    default: {
      let n = 0;
      // A getter that changes its answer (TOCTOU): valid first, CRLF later.
      return { get email() {
        return n++ === 0 ? 'ok@x.co' : 'evil@x.co\r\nBcc: v@x.co';
      } };
    }
  }
}

function junk(r: Rng, depth = 0): unknown {
  const k = Math.floor(r() * 30);
  switch (k) {
    case 0: return undefined;
    case 1: return null;
    case 2: return NaN;
    case 3: return pick(r, [Infinity, -Infinity, -0, 0, 1, -1, 2 ** 53, 1e300, 0.5, Number.MIN_VALUE]);
    case 4: return BigInt(Math.floor(r() * 1e6));
    case 5: return Symbol('junk');
    case 6: return () => 'fn';
    case 7: return true;
    case 8: return '';
    case 9: return ' \t\r\n';
    case 10: return 'a@b.co';
    case 11: return '𐀀\ud800 lone surrogate';
    case 12: return 'x\r\nBcc: injected@evil.test';
    case 13: return 'x'.repeat(Math.floor(r() * 200_000));
    case 14: return '<'.repeat(5000) + ' '.repeat(5000);
    case 15: return new Date(pick(r, [NaN, 0, 8.64e15, -8.64e15, Date.now()]));
    case 16: return new Uint8Array(Math.floor(r() * 64));
    case 17: return new ArrayBuffer(8);
    case 18: return new Blob(['x']);
    case 19: return depth < 3 ? Array.from({ length: Math.floor(r() * 5) }, () => junk(r, depth + 1)) : [];
    case 20: return depth < 3 ? { email: junk(r, depth + 1), name: junk(r, depth + 1) } : {};
    case 21: return r() < 0.1 ? new Array(1_000_000) : new Array(Math.floor(r() * 300)).fill('a@b.co');
    case 22: {
      const a: unknown[] = [];
      a.push(a);
      return a;
    }
    case 23: return new AbortController().signal;
    case 24: return pick(r, ['queued', 'sent', 'created_at_asc', '2024-01-01', '2024-02-30', 'Name <a@b.co>', 'aGk=', 'text/plain']);
    case 25: return { filename: junk(r, depth + 1), content: junk(r, depth + 1), contentType: junk(r, depth + 1) };
    case 26: return new String('a@b.co');
    case 27: return Promise.resolve('a@b.co');
    default: return hostileObject(r);
  }
}

function sendOptions(r: Rng): unknown {
  const base: Record<string, unknown> = { to: 'a@b.co', subject: 's', text: 't' };
  const keys = ['to', 'cc', 'bcc', 'subject', 'html', 'text', 'attachments', 'from', 'providerId', 'idempotencyKey', 'signal', 'timeoutMs', 'maxRetries', 'path', '__proto__'];
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const key = pick(r, keys);
    const v = key === 'attachments' && r() < 0.5 ? [junk(r), { filename: junk(r), content: junk(r), mimeType: junk(r) }] : junk(r);
    Object.defineProperty(base, key, { value: v, enumerable: true, configurable: true, writable: true });
  }
  if (r() < 0.05) return junk(r);
  if (r() < 0.05) return hostileObject(r);
  return base;
}

function listOptions(r: Rng): unknown {
  const o: Record<string, unknown> = {};
  for (const key of ['limit', 'offset', 'status', 'search', 'from', 'to', 'sort', 'signal', 'timeoutMs', 'maxRetries', 'path', 'query']) {
    if (r() < 0.3) o[key] = junk(r);
  }
  return r() < 0.1 ? junk(r) : o;
}

function settleWithin<T>(p: Promise<T>, ms: number): Promise<{ v?: T; e?: unknown; hung?: true }> {
  return Promise.race([
    p.then(
      (v) => ({ v }),
      (e) => ({ e }),
    ),
    new Promise<{ hung: true }>((res) => setTimeout(() => res({ hung: true }), ms).unref()),
  ]);
}

describe('seeded fuzzing of every public method', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  const protoBefore = Object.getOwnPropertyNames(Object.prototype).sort().join();
  beforeAll(() => {
    process.on('unhandledRejection', onUnhandled);
    process.on('uncaughtException', onUnhandled);
  });
  afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
    process.off('uncaughtException', onUnhandled);
  });

  const methods: Array<[string, (u: Unsent, r: Rng) => Promise<unknown>]> = [
    ['send', (u, r) => u.send(sendOptions(r) as never)],
    ['emails.send', (u, r) => u.emails.send(sendOptions(r) as never)],
    ['emails.get', (u, r) => u.emails.get(junk(r) as never, (r() < 0.5 ? listOptions(r) : undefined) as never)],
    ['emails.get(valid id)', (u, r) => u.emails.get(1, listOptions(r) as never)],
    ['emails.list', (u, r) => u.emails.list(listOptions(r) as never)],
    [
      'emails.iterate',
      async (u, r) => {
        const out = [];
        for await (const e of u.emails.iterate(listOptions(r) as never)) {
          out.push(e);
          if (out.length > 3) break;
        }
        return out;
      },
    ],
    ['emails.wait', (u, r) => u.emails.wait((r() < 0.5 ? 1 : junk(r)) as never, { timeoutMs: junk(r), intervalMs: junk(r), signal: junk(r) } as never)],
    ['status', (u, r) => u.status(listOptions(r) as never)],
    ['health', (u, r) => u.health(listOptions(r) as never)],
    ['attachmentFromFile', (_u, r) => attachmentFromFile(junk(r) as never, junk(r) as never)],
  ];

  it.each([1, 2, 3, 4, 5])('seed %i: 3000 random calls only produce UnsentError', async (seed) => {
    const r = mulberry32(seed * 7919);
    const u = client();
    const failures: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const [name, fn] = pick(r, methods);
      let p: Promise<unknown>;
      try {
        p = fn(u, r);
      } catch (e) {
        failures.push(`${name}: threw synchronously ${String((e as Error)?.name)}`);
        continue;
      }
      const res = await settleWithin(p, 2000);
      if (res.hung) failures.push(`${name}: did not settle within 2s (iteration ${i})`);
      else if ('e' in res && !(res.e instanceof UnsentError)) {
        failures.push(`${name}: ${(res.e as Error)?.name}: ${String((res.e as Error)?.message).slice(0, 120)} (iteration ${i})`);
      }
    }
    expect(failures).toEqual([]);
    expect(unhandled).toEqual([]);
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(protoBefore);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, 60_000);

  it('constructor, fromEnv and the Emails class with junk only throw UnsentError', () => {
    const r = mulberry32(42);
    const bad: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const opts: Record<string, unknown> =
        r() < 0.1
          ? (junk(r) as Record<string, unknown>)
          : { baseUrl: r() < 0.5 ? BASE : junk(r), apiKey: r() < 0.5 ? 'k' : junk(r), apiSecret: junk(r), timeoutMs: junk(r), maxRetries: junk(r), fetch: r() < 0.5 ? undefined : junk(r), defaultFrom: junk(r), defaultProviderId: junk(r) };
      for (const make of [() => new Unsent(opts as never), () => Unsent.fromEnv(junk(r) as never, opts as never)]) {
        try {
          make();
        } catch (e) {
          if (!(e instanceof UnsentError)) bad.push(`${(e as Error)?.name}: ${(e as Error)?.message}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('the exported Emails class misused directly still only rejects with UnsentError', async () => {
    const e = new (Emails as unknown as new (...a: unknown[]) => Emails)({}, {});
    for (const p of [e.send({ to: 'a@b.co', subject: 's', text: 't' }), e.get(1), e.list(), e.wait(1)]) {
      const err = await p.catch((x) => x);
      expect(err).toBeInstanceOf(UnsentError);
    }
  });

  it('hostile server responses (seeded) only produce UnsentError and never pollute prototypes', async () => {
    const r = mulberry32(1234);
    const bodies = [
      () => 'null',
      () => '[]',
      () => '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}},"id":1,"email":{"__proto__":{"polluted":2},"id":1}}',
      () => '{"email":{"id":{"toString":null,"valueOf":null},"subject":{"toString":null},"to":"x","attachments":[null,1,{"size":"x","content":5}],"failover_history":"[{\\"timestamp\\":{}}]","created_at":"9e999"}}',
      () => '{"emails":[{"id":1,"to":[1,{},"a@b.co"],"status":"pwned","attempts":"NaN"}],"total":"Infinity","offset":{},"limit":-5}',
      () => JSON.stringify({ id: 1, status: { x: 1 }, targetProvider: { toString: 5 }, idempotent_replay: 'true', queued: 'x', timestamp: 'never' }),
      () => '{"error":{"toString":null},"code":"constructor","reason":["x"]}',
      () => '{"error":"x","code":"__proto__"}',
      () => '{"error":"x","code":"toString","id":"3"}',
      () => '{"truncated": ',
      () => '\u0000￿ garbage',
      () => '',
      () => JSON.stringify({ email: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i])) }),
    ];
    const statuses = [200, 201, 202, 204, 400, 401, 403, 404, 409, 413, 418, 425, 429, 500, 501, 503, 505, 599];
    const headerSets = [
      {},
      { 'Retry-After': '99999999999' },
      { 'Retry-After': '-1' },
      { 'Retry-After': 'Wed, 21 Oct 2099 07:28:00 GMT' },
      { Date: 'Sat, 01 Jan 275760 00:00:00 GMT' },
      { Date: 'garbage' },
      { 'Idempotent-Replayed': 'true' },
    ];
    for (let i = 0; i < 400; i++) {
      const body = pick(r, bodies)();
      const status = pick(r, statuses);
      const headers = pick(r, headerSets);
      const u = new Unsent({
        baseUrl: BASE,
        apiKey: 'k',
        apiSecret: 's',
        maxRetries: 0,
        timeoutMs: 1000,
        fetch: async () => new Response(status === 204 ? null : body, { status, headers: headers as Record<string, string> }),
      });
      const calls: Array<() => Promise<unknown>> = [
        () => u.send({ to: 'a@b.co', subject: 's', text: 't' }),
        () => u.emails.get(1),
        () => u.emails.list(),
        () => u.status(),
        () => u.health(),
        () => u.emails.wait(1, { timeoutMs: 50 }),
      ];
      const res = await settleWithin(pick(r, calls)(), 3000);
      expect(res.hung).toBeUndefined();
      if ('e' in res) expect(res.e).toBeInstanceOf(UnsentError);
      if ('e' in res && res.e instanceof UnsentError) {
        expect(typeof res.e.message).toBe('string');
        expect(res.e.hint === undefined || typeof res.e.hint === 'string').toBe(true);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).sort().join()).toBe(protoBefore);
  }, 60_000);
});

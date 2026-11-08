/** Client-side validation: ids, list filters, dates, per-call transport options, wait() options and size caps. */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Unsent, UnsentConfigError, UnsentValidationError } from '../src';
import { attachmentFromFile } from '../src/node';
import { accepted, json, mockFetch } from './helpers';

const BASE = 'https://unsent.test';
const page = () => json({ emails: [], total: 0, limit: 100, offset: 0 });

function setup(handler = () => accepted()) {
  const m = mockFetch((req) => (req.url.pathname === '/api/send' ? handler() : req.url.pathname === '/api/emails' ? page() : json({ email: { id: 1, status: 'sent' }, queued: 0, status: 'ok' })));
  return { m, u: new Unsent({ baseUrl: BASE, apiKey: 'k', apiSecret: 's', fetch: m.fetch, maxRetries: 0 }) };
}
const msg = { to: 'a@b.co', subject: 's', text: 't' };

async function rejectsValidation(p: Promise<unknown>, code = 'validation_error') {
  const err = await p.then(
    () => undefined,
    (e) => e,
  );
  expect(err).toBeInstanceOf(UnsentValidationError);
  expect(err.code).toBe(code);
}

describe('ids (path injection)', () => {
  it.each([0, -1, 1.5, NaN, Infinity, 2 ** 53, '1', '1/../keys', '1?x=1', 1n, null, undefined, {}, [1], true])('get(%s) is rejected', async (id) => {
    const { m, u } = setup();
    await rejectsValidation(u.emails.get(id as never));
    await rejectsValidation(u.emails.wait(id as never));
    expect(m.calls).toHaveLength(0);
  });

  it('accepts the largest safe integer', async () => {
    const { m, u } = setup();
    await u.emails.get(Number.MAX_SAFE_INTEGER);
    expect(m.calls[0]!.url.pathname).toBe(`/api/emails/${Number.MAX_SAFE_INTEGER}`);
  });
});

describe('list() filters', () => {
  it.each([
    { status: 'bogus' },
    { status: "sent' OR 1=1 --" },
    { status: 'SENT' },
    { status: 1 },
    { sort: 'id; DROP TABLE emails' },
    { sort: 'created_at' },
    { sort: ['created_at_asc'] },
    { search: 5 },
    { search: {} },
    { search: ['a'] },
    { offset: 1e300 },
    { offset: 2 ** 53 },
    { offset: -1 },
    { offset: 0.5 },
    { offset: '1' },
    { limit: 0 },
    { limit: 201 },
    { limit: 1.5 },
    { limit: '10' },
    { from: '2024-02-30' },
    { from: '2023-02-29' },
    { from: '2024-99-99' },
    { from: '2024-13-01' },
    { from: '2024-00-10' },
    { to: '2024-01-32' },
    { to: '2024-01-01junk' },
    { to: '20240101' },
    { from: new Date(NaN) },
    { from: new Date(Date.UTC(10000, 0, 1)) },
    { from: new Date(-1e14) },
    { from: 20240101 },
    { from: {} },
  ])('rejects %j', async (opts) => {
    const { m, u } = setup();
    await rejectsValidation(u.emails.list(opts as never));
    expect(m.calls).toHaveLength(0);
  });

  it('accepts every documented status/sort and real dates, including leap days and ISO datetimes', async () => {
    const { m, u } = setup();
    for (const status of ['queued', 'sending', 'sent', 'failed'] as const) await u.emails.list({ status });
    for (const sort of ['updated_at_desc', 'updated_at_asc', 'created_at_desc', 'created_at_asc', 'attempts_desc'] as const) await u.emails.list({ sort });
    await u.emails.list({ from: '2024-02-29', to: '2024-03-01T23:59:59Z' });
    await u.emails.list({ from: new Date(Date.UTC(2024, 1, 29, 23, 0)) });
    expect(m.calls.at(-2)!.url.searchParams.get('to')).toBe('2024-03-01');
    expect(m.calls.at(-1)!.url.searchParams.get('from')).toBe('2024-02-29');
  });

  it('encodes search exactly, whatever it contains', async () => {
    const { m, u } = setup();
    const nasty = `' OR 1=1; -- %_ & = # ? / \\ "😀" \u202e\u0000 ${'x'.repeat(4000)}`;
    await u.emails.list({ search: nasty });
    expect(m.calls[0]!.url.searchParams.get('q')).toBe(nasty);
    expect([...m.calls[0]!.url.searchParams.keys()]).toEqual(['q']);
  });
});

describe('per-call transport options', () => {
  const bad = [NaN, -1, 0, Infinity, -Infinity, 2 ** 31, 1e12, '1000', null, {}];
  it.each(bad)('rejects timeoutMs=%s on every method', async (timeoutMs) => {
    const { m, u } = setup();
    await rejectsValidation(u.send({ ...msg, timeoutMs } as never));
    await rejectsValidation(u.emails.get(1, { timeoutMs } as never));
    await rejectsValidation(u.emails.list({ timeoutMs } as never));
    await rejectsValidation(u.status({ timeoutMs } as never));
    await rejectsValidation(u.health({ timeoutMs } as never));
    expect(m.calls).toHaveLength(0);
  });

  it.each([NaN, -1, 1.5, 11, Infinity, 1e9, '3', null])('rejects maxRetries=%s', async (maxRetries) => {
    const { m, u } = setup();
    await rejectsValidation(u.send({ ...msg, maxRetries } as never));
    await rejectsValidation(u.emails.list({ maxRetries } as never));
    expect(m.calls).toHaveLength(0);
  });

  it.each([{}, 'signal', { aborted: false }, { aborted: 'no', addEventListener() {}, removeEventListener() {} }])('rejects signal=%j', async (signal) => {
    const { m, u } = setup();
    await rejectsValidation(u.send({ ...msg, signal } as never));
    await rejectsValidation(u.emails.wait(1, { signal } as never));
    expect(m.calls).toHaveLength(0);
  });

  it('client-level timeoutMs above the setTimeout range is a config error (it would fire immediately)', () => {
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', timeoutMs: 2 ** 31 })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', timeoutMs: 2 ** 31 - 1 })).not.toThrow();
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', fetch: 'nope' as never })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', defaultFrom: 'bad addr' })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k', defaultProviderId: 5 as never })).toThrow(UnsentConfigError);
  });
});

describe('wait() options', () => {
  it.each([{ timeoutMs: NaN }, { timeoutMs: -5 }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { intervalMs: NaN }, { intervalMs: -1 }, { intervalMs: Infinity }, { intervalMs: '10' }])(
    'rejects %j instead of busy-polling or never timing out',
    async (opts) => {
      const { m, u } = setup();
      await rejectsValidation(u.emails.wait(1, opts as never));
      expect(m.calls).toHaveLength(0);
    },
  );
});

describe('size limits', () => {
  it('rejects a request body over 3 MiB before any network I/O', async () => {
    const { m, u } = setup();
    await rejectsValidation(u.send({ ...msg, html: 'x'.repeat(3 * 1024 * 1024 + 1) }), 'payload_too_large');
    // UTF-8 byte length counts, not UTF-16 length.
    await rejectsValidation(u.send({ ...msg, html: '€'.repeat(1_100_000) }), 'payload_too_large');
    expect(m.calls).toHaveLength(0);
  });

  it('accepts a body right below the cap', async () => {
    const { m, u } = setup();
    await u.send({ ...msg, html: 'x'.repeat(3 * 1024 * 1024 - 400) });
    expect(new TextEncoder().encode(m.calls[0]!.body).byteLength).toBeLessThanOrEqual(3 * 1024 * 1024);
  });

  it('rejects an oversize attachment before base64-encoding it', async () => {
    const { m, u } = setup();
    const big = new Uint8Array(3 * 1024 * 1024);
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a.bin', content: big }] }), 'payload_too_large');
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a.bin', content: big.buffer }] }), 'payload_too_large');
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a.bin', content: new Blob([big]) }] }), 'payload_too_large');
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a.bin', content: 'A'.repeat(4 * 1024 * 1024) }] }), 'payload_too_large');
    expect(m.calls).toHaveLength(0);
  });

  it('enforces 20 attachments and 100 recipients per field', async () => {
    const { m, u } = setup();
    const att = (n: number) => Array.from({ length: n }, (_, i) => ({ filename: `f${i}.txt`, content: 'aGk=' }));
    const rcpts = (n: number) => Array.from({ length: n }, (_, i) => `r${i}@example.com`);
    await u.send({ ...msg, attachments: att(20), to: rcpts(100), cc: rcpts(100), bcc: rcpts(100) });
    await rejectsValidation(u.send({ ...msg, attachments: att(21) }));
    await rejectsValidation(u.send({ ...msg, to: rcpts(101) }));
    await rejectsValidation(u.send({ ...msg, cc: rcpts(101) }));
    await rejectsValidation(u.send({ ...msg, bcc: rcpts(101) }));
    // Blank entries do not count, but a huge array is refused without walking it.
    await u.send({ ...msg, to: [...rcpts(100), '', ' ', undefined as never] });
    await rejectsValidation(u.send({ ...msg, to: new Array(1_000_000).fill('') }));
    expect(m.calls).toHaveLength(2);
  });
});

describe('attachments', () => {
  it.each([5, {}, [], true, Symbol('x')])('a non-string filename (%s) is a validation error, not a TypeError', async (filename) => {
    const { m, u } = setup();
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: filename as never, content: 'aGk=' }] }));
    expect(m.calls).toHaveLength(0);
  });

  it.each([5, {}, [], true])('a non-string contentType/mimeType (%s) is a validation error', async (t) => {
    const { u } = setup();
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a', content: 'aGk=', contentType: t as never }] }));
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a', content: 'aGk=', mimeType: t as never }] }));
  });

  it('rejects other content types and invalid base64', async () => {
    const { u } = setup();
    for (const content of [new Uint16Array(4), new DataView(new ArrayBuffer(4)), 5, null, {}, [1, 2], 'not base64!', 'aGk', 'a===', '====']) {
      await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a', content: content as never }] }));
    }
  });

  it('a Blob that cannot be read is a validation error', async () => {
    const { u } = setup();
    const blob = new Blob(['hi']);
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.reject(new Error('disk gone')) });
    await rejectsValidation(u.send({ ...msg, attachments: [{ filename: 'a', content: blob }] }));
  });

  it('uses the File name and type when not given', async () => {
    const { m, u } = setup();
    await u.send({ ...msg, attachments: [{ content: new File(['hi'], 'note.txt', { type: 'text/plain' }) }] });
    expect(m.calls[0]!.json.attachments).toEqual([{ filename: 'note.txt', content: 'aGk=', mimeType: 'text/plain' }]);
  });
});

describe('attachmentFromFile (node helper)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unsent-sdk-test-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a regular file', async () => {
    const p = join(dir, 'a.pdf');
    writeFileSync(p, Buffer.from([1, 2, 3]));
    const att = await attachmentFromFile(p);
    expect(att).toMatchObject({ filename: 'a.pdf', contentType: 'application/pdf' });
    expect([...(att.content as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('refuses directories, devices (/dev/zero would never end) and oversize files with SDK errors', async () => {
    mkdirSync(join(dir, 'sub'));
    await rejectsValidation(attachmentFromFile(join(dir, 'sub')), 'invalid_attachment');
    await rejectsValidation(attachmentFromFile('/dev/zero'), 'invalid_attachment');
    await rejectsValidation(attachmentFromFile(join(dir, 'missing.txt')), 'invalid_attachment');
    const big = join(dir, 'big.bin');
    writeFileSync(big, Buffer.alloc(3 * 1024 * 1024));
    await rejectsValidation(attachmentFromFile(big), 'payload_too_large');
    for (const bad of [5, '', 'a\0b', null]) await rejectsValidation(attachmentFromFile(bad as never));
    await rejectsValidation(attachmentFromFile(join(dir, 'a.pdf'), { filename: 5 as never }));
  });
});

describe('response shape guards', () => {
  const hostile = (body: string, status = 200) => new Unsent({ baseUrl: BASE, apiKey: 'k', maxRetries: 0, fetch: async () => new Response(body, { status }) });

  it.each(['null', '[]', '"str"', '42', 'true', '{"email":null}', '{"email":"x"}', '{"emails":"x"}', '{"emails":[null]}', '{"emails":[1]}', '{"id":"abc"}', '{"id":-1}', '{"id":1.5}', '{}'])(
    'body %s is either mapped or rejected with invalid_response',
    async (body) => {
      const u = hostile(body);
      for (const call of [() => u.send(msg), () => u.emails.get(1), () => u.emails.list(), () => u.status(), () => u.health()]) {
        const r = await call().then(
          (v) => ({ v }),
          (e) => ({ e }),
        );
        if ('e' in r) {
          expect(r.e.constructor.name).toMatch(/^Unsent/);
          expect(r.e.code).toBe('invalid_response');
        }
      }
    },
  );
});

import { describe, expect, it } from 'vitest';
import { Unsent, UnsentValidationError } from '../src';
import { API_KEY, API_SECRET, BASE, accepted, json, mockFetch, verifySigned } from './helpers';

function client(handler = () => accepted(), extra: Record<string, unknown> = {}) {
  const m = mockFetch(handler);
  return { m, unsent: new Unsent({ baseUrl: BASE, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch, ...extra }) };
}

describe('send(): wire format and signing', () => {
  it('sends a correctly signed request the server accepts', async () => {
    const { m, unsent } = client();
    const res = await unsent.send({ from: 'me@x.co', to: 'a@b.co', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' });
    const req = m.calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url.pathname).toBe('/api/send');
    expect(req.headers.get('Content-Type')).toBe('application/json');
    expect(verifySigned(req)).toEqual({ ok: true });
    expect(res).toMatchObject({ id: 1, status: 'queued', idempotentReplay: false });
  });

  it('never sends routing or idempotency headers (they are not covered by the signature)', async () => {
    const { m, unsent } = client();
    await unsent.send({ from: 'me@x.co', to: 'a@b.co', subject: 's', html: 'h', providerId: 'p1' });
    const h = m.calls[0]!.headers;
    for (const name of ['X-Provider-Id', 'X-Sender-Email', 'Idempotency-Key']) expect(h.has(name)).toBe(false);
    expect(m.calls[0]!.json.provider_id).toBe('p1');
    expect(m.calls[0]!.json.from).toEqual({ email: 'me@x.co' });
  });

  it('signs even unicode and large bodies byte-exactly', async () => {
    const { m, unsent } = client();
    await unsent.send({ to: 'a@b.co', subject: 'Grüße 🎉', html: '<p>日本語 — "quotes" \\ \n</p>'.repeat(5000) });
    expect(verifySigned(m.calls[0]!)).toEqual({ ok: true });
  });

  it('uses a fresh nonce and timestamp-bound signature on every call', async () => {
    const { m, unsent } = client();
    const used = new Set<string>();
    for (let i = 0; i < 20; i++) await unsent.send({ to: 'a@b.co', subject: 's', html: 'h' });
    for (const c of m.calls) expect(verifySigned(c, API_SECRET, used)).toEqual({ ok: true });
    expect(used.size).toBe(20);
  });

  it('sends only the API key (no signature) when no apiSecret is configured', async () => {
    const m = mockFetch(() => accepted());
    const unsent = new Unsent({ baseUrl: BASE, apiKey: API_KEY, fetch: m.fetch });
    await unsent.send({ to: 'a@b.co', subject: 's', html: 'h' });
    const h = m.calls[0]!.headers;
    expect(h.get('X-API-Key')).toBe(API_KEY);
    expect(h.has('X-Signature')).toBe(false);
    expect(h.has('X-Nonce')).toBe(false);
  });
});

describe('send(): message building', () => {
  it('parses "Name <email>" and {email,name} senders', async () => {
    const { m, unsent } = client();
    await unsent.send({ from: 'Acme Support <help@acme.co>', to: 'a@b.co', subject: 's', html: 'h' });
    await unsent.send({ from: { email: 'help@acme.co', name: 'Acme' }, to: 'a@b.co', subject: 's', html: 'h' });
    await unsent.send({ from: '"Doe, Jane" <j@acme.co>', to: 'a@b.co', subject: 's', html: 'h' });
    expect(m.calls[0]!.json.from).toEqual({ email: 'help@acme.co', name: 'Acme Support' });
    expect(m.calls[1]!.json.from).toEqual({ email: 'help@acme.co', name: 'Acme' });
    expect(m.calls[2]!.json.from).toEqual({ email: 'j@acme.co', name: 'Doe, Jane' });
  });

  it('applies defaultFrom and defaultProviderId, with per-call overrides', async () => {
    const { m, unsent } = client(() => accepted(), { defaultFrom: 'default@x.co', defaultProviderId: 'prov-a' });
    await unsent.send({ to: 'a@b.co', subject: 's', html: 'h' });
    await unsent.send({ to: 'a@b.co', subject: 's', html: 'h', from: 'other@x.co', providerId: 'prov-b' });
    expect(m.calls[0]!.json).toMatchObject({ from: { email: 'default@x.co' }, provider_id: 'prov-a' });
    expect(m.calls[1]!.json).toMatchObject({ from: { email: 'other@x.co' }, provider_id: 'prov-b' });
  });

  it('derives an escaped HTML body from text-only sends (the API requires html)', async () => {
    const { m, unsent } = client();
    await unsent.send({ to: 'a@b.co', subject: 's', text: 'Line 1\n<b>& "x"</b>' });
    const body = m.calls[0]!.json;
    expect(body.text).toBe('Line 1\n<b>& "x"</b>');
    expect(body.html).toBe('<div style="white-space:pre-wrap">Line 1\n&lt;b&gt;&amp; &quot;x&quot;&lt;/b&gt;</div>');
  });

  it('accepts string or array recipients plus cc/bcc, and omits empty optional fields', async () => {
    const { m, unsent } = client();
    await unsent.send({ to: ['a@b.co', ' c@d.co '], cc: 'e@f.co', bcc: [], subject: 's', html: 'h' });
    expect(m.calls[0]!.json.to).toEqual(['a@b.co', 'c@d.co']);
    expect(m.calls[0]!.json.cc).toEqual(['e@f.co']);
    expect('bcc' in m.calls[0]!.json).toBe(false);
    expect('attachments' in m.calls[0]!.json).toBe(false);
    expect('from' in m.calls[0]!.json).toBe(false);
  });

  it('encodes attachments from every supported content type', async () => {
    const { m, unsent } = client();
    await unsent.send({
      to: 'a@b.co',
      subject: 's',
      html: 'h',
      attachments: [
        { filename: 'a.txt', content: new TextEncoder().encode('hello'), contentType: 'text/plain' },
        { filename: 'b.bin', content: new Uint8Array([0, 255, 16]).buffer as ArrayBuffer, mimeType: 'application/octet-stream' },
        { filename: 'c.txt', content: 'aGVsbG8=\n' },
        { content: new File(['file-body'], 'd.txt', { type: 'text/plain' }) },
        { filename: 'e.bin', content: new Uint8Array(100_000).fill(7) },
      ],
    });
    const a = m.calls[0]!.json.attachments;
    expect(a[0]).toEqual({ filename: 'a.txt', content: 'aGVsbG8=', mimeType: 'text/plain' });
    expect(a[1].content).toBe(Buffer.from([0, 255, 16]).toString('base64'));
    expect(a[2]).toEqual({ filename: 'c.txt', content: 'aGVsbG8=' });
    expect(a[3]).toEqual({ filename: 'd.txt', content: Buffer.from('file-body').toString('base64'), mimeType: 'text/plain' });
    expect(a[4].content).toBe(Buffer.alloc(100_000, 7).toString('base64'));
  });

  it('maps the response, including replays', async () => {
    const { unsent } = client(() =>
      json({ success: true, id: 9, status: 'sent', idempotency_key: 'k-1', idempotent_replay: true, message: 'm', targetProvider: 'SES' }, 200, {
        'Idempotent-Replayed': 'true',
      }),
    );
    expect(await unsent.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: 'k-1' })).toEqual({
      id: 9,
      status: 'sent',
      idempotencyKey: 'k-1',
      idempotentReplay: true,
      targetProvider: 'SES',
      message: 'm',
    });
  });
});

describe('send(): idempotency keys', () => {
  it('generates a UUID key per call, covered by the signed body', async () => {
    const { m, unsent } = client();
    const r1 = await unsent.send({ to: 'a@b.co', subject: 's', html: 'h' });
    const r2 = await unsent.send({ to: 'a@b.co', subject: 's', html: 'h' });
    const k1 = m.calls[0]!.json.idempotency_key;
    expect(k1).toMatch(/^[0-9a-f-]{36}$/);
    expect(m.calls[1]!.json.idempotency_key).not.toBe(k1);
    expect(r1.idempotencyKey).toBe(k1);
    expect(r2.idempotencyKey).not.toBe(k1);
  });

  it('uses a caller-supplied key and trims it', async () => {
    const { m, unsent } = client();
    await unsent.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: ' order-123:receipt ' });
    expect(m.calls[0]!.json.idempotency_key).toBe('order-123:receipt');
  });

  it('omits the key when disabled with false', async () => {
    const { m, unsent } = client();
    const res = await unsent.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: false });
    expect('idempotency_key' in m.calls[0]!.json).toBe(false);
    expect(res.idempotencyKey).toBeNull();
  });

  it.each(['', '  ', 'has space', 'tab\there', 'ünï', 'x'.repeat(256)])('rejects invalid key %j before any request', async (key) => {
    const { m, unsent } = client();
    await expect(unsent.send({ to: 'a@b.co', subject: 's', html: 'h', idempotencyKey: key })).rejects.toMatchObject({ code: 'invalid_idempotency_key' });
    expect(m.calls).toHaveLength(0);
  });
});

describe('send(): client-side validation (nothing is sent)', () => {
  const cases: Array<[string, any, RegExp]> = [
    ['missing to', { subject: 's', html: 'h' }, /"to" is required/],
    ['empty to array', { to: [], subject: 's', html: 'h' }, /at least one/],
    ['blank to', { to: '  ', subject: 's', html: 'h' }, /at least one/],
    ['non-string to entry', { to: [1], subject: 's', html: 'h' }, /string/],
    ['address without @', { to: 'nope', subject: 's', html: 'h' }, /invalid address/],
    ['CRLF in address', { to: 'a@b.co\r\nBcc: x@y.z', subject: 's', html: 'h' }, /line break/],
    ['101 recipients', { to: Array.from({ length: 101 }, (_, i) => `u${i}@x.co`), subject: 's', html: 'h' }, /maximum 100/],
    ['missing subject', { to: 'a@b.co', html: 'h' }, /"subject" is required/],
    ['blank subject', { to: 'a@b.co', subject: '   ', html: 'h' }, /"subject" is required/],
    ['huge subject', { to: 'a@b.co', subject: 'x'.repeat(1001), html: 'h' }, /maximum 1000/],
    ['no body', { to: 'a@b.co', subject: 's' }, /"html", "text"/],
    ['blank bodies', { to: 'a@b.co', subject: 's', html: ' ', text: ' ' }, /"html", "text"/],
    ['non-string html', { to: 'a@b.co', subject: 's', html: 5 }, /"html" must be a string/],
    ['attachments not array', { to: 'a@b.co', subject: 's', html: 'h', attachments: {} }, /must be an array/],
    ['21 attachments', { to: 'a@b.co', subject: 's', html: 'h', attachments: Array.from({ length: 21 }, () => ({ filename: 'a', content: 'QQ==' })) }, /maximum 20/],
    ['attachment without filename', { to: 'a@b.co', subject: 's', html: 'h', attachments: [{ content: 'QQ==' }] }, /filename is required/],
    ['attachment with plain text content', { to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a.txt', content: 'hello world' }] }, /valid base64/],
    ['attachment with bad content type', { to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: 42 }] }, /must be a base64 string/],
    ['empty attachment', { to: 'a@b.co', subject: 's', html: 'h', attachments: [{ filename: 'a', content: new Uint8Array(0) }] }, /empty/],
    ['bad from', { to: 'a@b.co', subject: 's', html: 'h', from: '' }, /"from"/],
    ['bad from object', { to: 'a@b.co', subject: 's', html: 'h', from: { name: 'x' } }, /from\.email/],
    ['blank providerId', { to: 'a@b.co', subject: 's', html: 'h', providerId: ' ' }, /providerId/],
    ['no options', undefined, /options object/],
  ];
  it.each(cases)('%s', async (_name, opts, message) => {
    const { m, unsent } = client();
    const err = await unsent.send(opts).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentValidationError);
    expect(err.message).toMatch(message);
    expect(m.calls).toHaveLength(0);
  });
});

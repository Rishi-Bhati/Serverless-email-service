/**
 * Live end-to-end tests against a real Unsent worker (`wrangler dev`), covering the parts mocks cannot:
 * HMAC compatibility with the actual server code, nonce replay protection, idempotency in D1, and delivery.
 *
 * UNSENT_E2E_BASE_URL=http://localhost:8799 UNSENT_E2E_API_KEY=... UNSENT_E2E_API_SECRET=... \
 *   UNSENT_E2E_FROM=noreply@e2e.test npm run test:e2e
 *
 * The worker must be in SECURITY_MODE=full with an SMTP (or provider) that can accept mail.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Unsent, UnsentAuthenticationError, UnsentConflictError, UnsentNotFoundError, UnsentRequestError } from '../src';

const baseUrl = process.env.UNSENT_E2E_BASE_URL;
const apiKey = process.env.UNSENT_E2E_API_KEY ?? '';
const apiSecret = process.env.UNSENT_E2E_API_SECRET ?? '';
const from = process.env.UNSENT_E2E_FROM;
const run = baseUrl ? describe : describe.skip;

const uid = () => Math.random().toString(36).slice(2, 10);

run('live worker', () => {
  // Created lazily: vitest still collects describe.skip bodies, and the constructor needs a baseUrl.
  let unsent!: Unsent;
  beforeAll(() => {
    unsent = new Unsent({ baseUrl: baseUrl!, apiKey, apiSecret, defaultFrom: from });
  });
  afterEach(() => vi.restoreAllMocks());

  it('health and authenticated status', async () => {
    expect((await unsent.health()).status).toBe('ok');
    const s = await unsent.status();
    expect(Object.keys(s).sort()).toEqual(['failed', 'queued', 'sent', 'sending'].sort());
  });

  it('sends a text-only email and sees it delivered', async () => {
    const tag = uid();
    const res = await unsent.send({ to: `rcpt-${tag}@example.com`, subject: `e2e text ${tag}`, text: 'Plain *text* <ok>' });
    expect(res).toMatchObject({ status: 'queued', idempotentReplay: false });
    const email = await unsent.emails.wait(res.id, { timeoutMs: 30_000 });
    expect(email.status).toBe('sent');
    expect(email.to).toEqual([`rcpt-${tag}@example.com`]);
    expect(email.textBody).toBe('Plain *text* <ok>');
    expect(email.htmlBody).toContain('Plain *text* &lt;ok&gt;');
    expect(email.idempotencyKey).toBe(res.idempotencyKey);
  });

  it('round-trips html + text + cc + bcc + attachments with binary-safe content', async () => {
    const tag = uid();
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const res = await unsent.send({
      from: { email: from!, name: 'E2E Sender' },
      to: [`a-${tag}@example.com`, `b-${tag}@example.com`],
      cc: `c-${tag}@example.com`,
      bcc: [`d-${tag}@example.com`],
      subject: `e2e full ${tag}`,
      html: `<h1>${tag}</h1>`,
      text: `text ${tag}`,
      attachments: [
        { filename: 'bytes.bin', content: bytes, contentType: 'application/octet-stream' },
        { filename: 'hello.txt', content: 'aGVsbG8=', contentType: 'text/plain' },
      ],
    });
    const email = await unsent.emails.wait(res.id, { timeoutMs: 30_000 });
    expect(email.status).toBe('sent');
    expect(email.fromName).toBe('E2E Sender');
    expect(email.cc).toEqual([`c-${tag}@example.com`]);
    expect(email.bcc).toEqual([`d-${tag}@example.com`]);
    expect(email.textBody).toBe(`text ${tag}`);
    expect(email.attachments.map((a) => [a.filename, a.size, a.mimeType])).toEqual([
      ['bytes.bin', 256, 'application/octet-stream'],
      ['hello.txt', 5, 'text/plain'],
    ]);
    expect(Buffer.from(email.attachments[0]!.content, 'base64').equals(Buffer.from(bytes))).toBe(true);

    const listed = await unsent.emails.list({ search: tag });
    expect(listed.emails.find((e) => e.id === res.id)?.attachments).toEqual([
      { filename: 'bytes.bin', mimeType: 'application/octet-stream', size: 256 },
      { filename: 'hello.txt', mimeType: 'text/plain', size: 5 },
    ]);
  });

  it('is idempotent: replay returns the same email, a changed message conflicts', async () => {
    const key = `e2e-${uid()}`;
    const msg = { to: 'idem@example.com', subject: 'idem', text: 'same', idempotencyKey: key };
    const first = await unsent.send(msg);
    const again = await unsent.send(msg);
    expect(again).toMatchObject({ id: first.id, idempotentReplay: true, idempotencyKey: key });
    const err = await unsent.send({ ...msg, text: 'different' }).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentConflictError);
    expect(err.code).toBe('idempotency_key_conflict');
    expect(err.existingEmailId).toBe(first.id);
  });

  it('parallel sends with one key create exactly one email', async () => {
    const key = `e2e-par-${uid()}`;
    const results = await Promise.all(Array.from({ length: 6 }, () => unsent.send({ to: 'par@example.com', subject: 'par', text: 'x', idempotencyKey: key })));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.idempotentReplay)).toHaveLength(1);
  });

  it('many concurrent signed sends all pass nonce replay protection', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => unsent.send({ to: 'burst@example.com', subject: `burst ${i}`, text: 'x' })));
    expect(new Set(results.map((r) => r.id)).size).toBe(25);
  });

  it('corrects a skewed local clock automatically', async () => {
    const real = Date.now;
    vi.spyOn(Date, 'now').mockImplementation(() => real() - 10 * 60_000);
    const res = await unsent.send({ to: 'skew@example.com', subject: 'skew', text: 'x' });
    expect(res.id).toBeGreaterThan(0);
  });

  it('rejects wrong credentials with actionable errors', async () => {
    // `api-key-only` servers never check the secret, so only a wrong key is an authentication failure there.
    const mode = process.env.UNSENT_E2E_MODE ?? 'full';

    const badSecret = new Unsent({ baseUrl: baseUrl!, apiKey, apiSecret: 'wrong-secret', maxRetries: 0 });
    const e1 = await badSecret.send({ to: 'a@example.com', subject: 's', text: 't' }).catch((e) => e);
    if (mode === 'api-key-only') {
      expect(e1.id).toBeGreaterThan(0);
    } else {
      expect(e1).toBeInstanceOf(UnsentAuthenticationError);
      expect(e1.code).toBe('invalid_signature');
      expect(e1.hint).toMatch(/apiSecret/);
    }

    const badKey = new Unsent({ baseUrl: baseUrl!, apiKey: 'nope', apiSecret, maxRetries: 0 });
    expect(await badKey.send({ to: 'a@example.com', subject: 's', text: 't' }).catch((e) => e.code)).toBe('invalid_api_key');
    const e2 = await badKey.status().catch((e) => e);
    expect(e2).toBeInstanceOf(UnsentAuthenticationError);
    expect(e2.status).toBe(401);
    expect(e2.hint).toMatch(/apiKey/);

    if (mode !== 'api-key-only') {
      const noSecret = new Unsent({ baseUrl: baseUrl!, apiKey, maxRetries: 0 });
      const e3 = await noSecret.send({ to: 'a@example.com', subject: 's', text: 't' }).catch((e) => e);
      expect(e3).toBeInstanceOf(UnsentAuthenticationError);
      expect(e3.hint).toMatch(/signed requests/);
    }
  });

  it('rejects unauthorized senders and unknown emails', async () => {
    const err = await unsent.send({ from: 'stranger@evil.test', to: 'a@example.com', subject: 's', text: 't' }).catch((e) => e);
    expect(err).toBeInstanceOf(UnsentRequestError);
    expect(err.code).toBe('unauthorized_sender');
    await expect(unsent.emails.get(99_999_999)).rejects.toBeInstanceOf(UnsentNotFoundError);
  });

  it('paginates with iterate()', async () => {
    const ids: number[] = [];
    for await (const e of unsent.emails.iterate({ limit: 7 })) ids.push(e.id);
    expect(ids.length).toBeGreaterThan(14);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

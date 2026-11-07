import { afterEach, describe, expect, it, vi } from 'vitest';
import { Unsent, UnsentConfigError } from '../src';
import { API_KEY, API_SECRET, BASE, accepted, mockFetch } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ok = () => mockFetch(() => accepted()).fetch;

describe('construction', () => {
  it('requires baseUrl and apiKey with actionable messages', () => {
    vi.stubEnv('UNSENT_BASE_URL', '');
    vi.stubEnv('UNSENT_API_KEY', '');
    expect(() => new Unsent({ apiKey: 'k' })).toThrow(/baseUrl.*UNSENT_BASE_URL/s);
    expect(() => new Unsent({ baseUrl: BASE })).toThrow(/apiKey.*UNSENT_API_KEY/s);
    expect(() => new Unsent({ baseUrl: BASE })).toThrow(UnsentConfigError);
  });

  it('reads credentials from the environment and trims stray whitespace/newlines', async () => {
    vi.stubEnv('UNSENT_BASE_URL', `${BASE}/\n`);
    vi.stubEnv('UNSENT_API_KEY', ` ${API_KEY}\n`);
    vi.stubEnv('UNSENT_API_SECRET', `${API_SECRET}\n`);
    const m = mockFetch(() => accepted());
    const u = new Unsent({ fetch: m.fetch });
    await u.send({ to: 'a@b.co', subject: 's', text: 't' });
    expect(m.calls[0]!.url.href).toBe(`${BASE}/api/send`);
    expect(m.calls[0]!.headers.get('X-API-Key')).toBe(API_KEY);
    expect(m.calls[0]!.headers.has('X-Signature')).toBe(true);
  });

  it('explicit options win over the environment', () => {
    vi.stubEnv('UNSENT_BASE_URL', 'https://wrong.test');
    const m = mockFetch(() => accepted());
    const u = new Unsent({ baseUrl: BASE, apiKey: API_KEY, fetch: m.fetch });
    return u.send({ to: 'a@b.co', subject: 's', text: 't' }).then(() => expect(m.calls[0]!.url.origin).toBe(BASE));
  });

  it('fromEnv works with Worker-style bindings', async () => {
    const m = mockFetch(() => accepted());
    const u = Unsent.fromEnv(
      { UNSENT_BASE_URL: BASE, UNSENT_API_KEY: API_KEY, UNSENT_API_SECRET: API_SECRET },
      { fetch: m.fetch },
    );
    await u.send({ to: 'a@b.co', subject: 's', text: 't' });
    expect(m.calls[0]!.headers.get('X-Signature')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('keeps a path prefix and drops query/hash/trailing slashes', async () => {
    const m = mockFetch(() => accepted());
    await new Unsent({ baseUrl: `${BASE}/mail/?x=1#y`, apiKey: API_KEY, fetch: m.fetch }).send({ to: 'a@b.co', subject: 's', text: 't' });
    expect(m.calls[0]!.url.href).toBe(`${BASE}/mail/api/send`);
  });

  it('rejects malformed URLs, other protocols, embedded credentials and plain http to remote hosts', () => {
    const mk = (baseUrl: string) => () => new Unsent({ baseUrl, apiKey: 'k', fetch: ok() });
    expect(mk('not a url')).toThrow(/not a valid URL/);
    expect(mk('ftp://x.test')).toThrow(/https/);
    expect(mk('http://unsent.example.com')).toThrow(/plain http/);
    expect(mk('https://user:pw@unsent.example.com')).toThrow(/credentials/);
  });

  it('allows http for loopback development servers', () => {
    for (const host of ['localhost:8787', '127.0.0.1:8787', '[::1]:8787']) {
      expect(() => new Unsent({ baseUrl: `http://${host}`, apiKey: 'k', fetch: ok() })).not.toThrow();
    }
  });

  it('validates timeoutMs and maxRetries', () => {
    const base = { baseUrl: BASE, apiKey: 'k', fetch: ok() };
    expect(() => new Unsent({ ...base, timeoutMs: 0 })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ ...base, timeoutMs: Number.NaN })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ ...base, maxRetries: -1 })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ ...base, maxRetries: 1.5 })).toThrow(UnsentConfigError);
    expect(() => new Unsent({ ...base, maxRetries: 11 })).toThrow(UnsentConfigError);
  });

  it('refuses to run in a browser unless explicitly allowed', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const opts = { baseUrl: BASE, apiKey: 'k', fetch: ok() };
    expect(() => new Unsent(opts)).toThrow(/browser/);
    expect(() => new Unsent({ ...opts, dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it('fails clearly when no fetch exists', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => new Unsent({ baseUrl: BASE, apiKey: 'k' })).toThrow(/fetch/);
  });

  it('never exposes secrets through serialization or inspection', () => {
    const u = new Unsent({ baseUrl: BASE, apiKey: 'SUPER-KEY', apiSecret: 'SUPER-SECRET', fetch: ok() });
    const dump = JSON.stringify(u) + require('node:util').inspect(u, { depth: 10, showHidden: true });
    expect(dump).not.toContain('SUPER-KEY');
    expect(dump).not.toContain('SUPER-SECRET');
  });
});

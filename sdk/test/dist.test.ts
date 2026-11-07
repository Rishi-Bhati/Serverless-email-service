import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src';

const root = resolve(__dirname, '..');
const built = existsSync(resolve(root, 'dist/index.cjs'));

describe('package', () => {
  it('VERSION matches package.json', () => {
    expect(VERSION).toBe(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version);
  });
});

// Runs against the built output, exactly as consumers load it. Skipped until `npm run build`.
describe.skipIf(!built)('built package', () => {
  const run = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8' }).trim();
  const names = 'Unsent,Emails,UnsentError,UnsentAPIError,UnsentTimeoutError,UnsentConflictError,VERSION,MAX_DELIVERY_ATTEMPTS';

  it('loads as ESM through the package exports', () => {
    const out = run(['--input-type=module', '-e', `import * as m from 'unsent-sdk'; for (const n of '${names}'.split(',')) if (!(n in m)) throw new Error('missing '+n); console.log(typeof new m.Unsent({baseUrl:'https://x.test',apiKey:'k'}).send)`]);
    expect(out).toBe('function');
  });

  it('loads as CommonJS through the package exports', () => {
    const out = run(['-e', `const m = require('unsent-sdk'); for (const n of '${names}'.split(',')) if (!(n in m)) throw new Error('missing '+n); console.log(typeof new m.Unsent({baseUrl:'https://x.test',apiKey:'k'}).send)`]);
    expect(out).toBe('function');
  });

  it('ships the node helper in both formats', () => {
    expect(run(['--input-type=module', '-e', `import { attachmentFromFile } from 'unsent-sdk/node'; console.log(typeof attachmentFromFile)`])).toBe('function');
    expect(run(['-e', `console.log(typeof require('unsent-sdk/node').attachmentFromFile)`])).toBe('function');
  });

  it('works end-to-end from the built ESM bundle', () => {
    const out = run([
      '--input-type=module',
      '-e',
      `import { Unsent } from 'unsent-sdk';
       const u = new Unsent({ baseUrl: 'https://x.test', apiKey: 'k', apiSecret: 's', maxRetries: 0,
         fetch: async (url, init) => { if (!init.headers['X-Signature']) throw new Error('unsigned'); return new Response(JSON.stringify({id: 7, status: 'queued', message: 'ok', targetProvider: 'p'}), {status: 202}); } });
       console.log((await u.send({ to: 'a@b.co', subject: 's', text: 't' })).id);`,
    ]);
    expect(out).toBe('7');
  });
});

#!/usr/bin/env node
// Regression test: blind-copied recipients must be delivered to but never disclosed.
//
// Starts an isolated worker + SMTP sink, sends one email with a bcc address, then asserts on what the
// sink actually received:
//   * the envelope (RCPT TO) includes the bcc address, so the blind copy is delivered;
//   * the message headers contain no `BCC:` line, so the blind copy is not disclosed.
//
// usage: node scripts/test-bcc.mjs [port=8870]
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8870);
const e2eRoot = mkdtempSync(join(tmpdir(), 'unsent-bcc-'));
const script = join(root, 'scripts', 'e2e-server.sh');

function sh(args, opts = {}) {
  return execFileSync('bash', [script, ...args], { cwd: root, encoding: 'utf8', ...opts });
}

async function main() {
  const env = Object.fromEntries(
    sh(['start', String(port)], { env: { ...process.env, E2E_ROOT: e2eRoot } })
      .split('\n')
      .map((l) => l.match(/^export (\w+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]])
  );

  const warnings = [];
  const warn = (m) => warnings.push(m);

  const tag = 'bcc' + Math.random().toString(36).slice(2, 8);
  const mailsFile = env.UNSENT_E2E_MAILS_FILE;

  const { Unsent } = await import(join(root, 'sdk', 'dist', 'index.js'));
  const unsent = new Unsent({
    baseUrl: env.UNSENT_E2E_BASE_URL,
    apiKey: env.UNSENT_E2E_API_KEY,
    apiSecret: env.UNSENT_E2E_API_SECRET,
    defaultFrom: env.UNSENT_E2E_FROM,
  });

  const result = await unsent.send({
    to: [`visible-${tag}@example.com`],
    cc: [`cc-${tag}@example.com`],
    bcc: [`hidden-${tag}@example.com`],
    subject: `bcc regression ${tag}`,
    html: '<p>hi</p>',
  });
  const email = await unsent.emails.wait(result.id, { timeoutMs: 30_000 });
  if (email.status !== 'sent') throw new Error(`email ${result.id} is ${email.status}, not sent`);

  // Find our message in the sink's output.
  const lines = (existsSync(mailsFile) ? readFileSync(mailsFile, 'utf8') : '').split('\n').filter(Boolean);
  const mail = lines.map((l) => JSON.parse(l)).find((m) => (m.raw ?? '').includes(tag));
  if (!mail) throw new Error('the SMTP sink never received the message');

  const raw = mail.raw ?? '';
  const headers = raw.split('\r\n');
  const rcpt = mail.rcpt ?? [];

  const checks = [
    ['bcc is delivered (appears in RCPT TO)', rcpt.includes(`hidden-${tag}@example.com`)],
    ['to is delivered', rcpt.includes(`visible-${tag}@example.com`)],
    ['cc is delivered', rcpt.includes(`cc-${tag}@example.com`)],
    ['no BCC: header in the message', !headers.some((h) => /^bcc:/i.test(h))],
    ['the bcc address is not mentioned anywhere in the message', !raw.includes(`hidden-${tag}@example.com`)],
    ['the To header is still present', headers.some((h) => /^to:/i.test(h))],
    ['the CC header is still present', headers.some((h) => /^cc:/i.test(h))],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) failed++;
  }
  if (failed) {
    console.log('\n--- headers of the delivered message ---');
    console.log(headers.slice(0, 12).join('\n'));
    console.log('\n--- envelope (RCPT TO) ---');
    console.log(rcpt.join('\n'));
    throw new Error(`${failed} check(s) failed`);
  }
  if (warnings.length) console.log(warnings.join('\n'));
  console.log(`\nall ${checks.length} checks passed`);
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error('\n' + (err && err.message ? err.message : String(err)));
  exitCode = 1;
} finally {
  try { sh(['stop', String(port)], { env: { ...process.env, E2E_ROOT: e2eRoot } }); } catch (_) {}
  try { rmSync(e2eRoot, { recursive: true, force: true }); } catch (_) {}
}
process.exit(exitCode);

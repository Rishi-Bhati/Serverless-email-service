import { UnsentValidationError } from './errors';
import type { Address } from './types';

export const MAX_RECIPIENTS = 100;
/** The server's per-address limit. */
export const MAX_ADDRESS_LENGTH = 320;
/** Arrays longer than this are rejected before they are walked (blank entries are dropped, so allow some slack). */
const MAX_RECIPIENT_ARRAY = 1000;

/**
 * Characters that never belong in a bare mailbox the SDK sends: whitespace (incl. U+2028/U+2029/U+0085), controls,
 * and the address-list / header syntax characters `< > , ; " ( ) [ ] \`. Without this, one array entry such as
 * `"a@x.com, b@y.com"` would bypass the 100-recipient limit, and `<`/`>` would corrupt `RCPT TO` and the To header.
 * Two disjoint character classes around a single `@`: linear time, no backtracking.
 */
const MAILBOX_RE = /^[^\s@<>,;"()[\]\\\x00-\x1f\x7f\u0085]+@[^\s@<>,;"()[\]\\\x00-\x1f\x7f\u0085]+$/;
/** Display names are written into the From header verbatim by the server, quoted but not escaped. */
const BAD_NAME_RE = /["\\<>\x00-\x1f\x7f\u0085\u2028\u2029]/;

function checkMailbox(email: string, field: string): void {
  if (/[\r\n\0]/.test(email)) throw new UnsentValidationError(`"${field}" contains a line break or NUL character`);
  if (email.length > MAX_ADDRESS_LENGTH) {
    throw new UnsentValidationError(`"${field}" contains an address longer than ${MAX_ADDRESS_LENGTH} characters`);
  }
  if (!MAILBOX_RE.test(email)) {
    throw new UnsentValidationError(
      `"${field}" contains an invalid address: ${JSON.stringify(email.slice(0, 100))}. Use one bare address per entry (no spaces, commas, quotes or <>).`,
    );
  }
}

function checkName(name: string, field: string): void {
  if (/[\r\n\0]/.test(name)) throw new UnsentValidationError(`"${field}" contains a line break or NUL character`);
  if (BAD_NAME_RE.test(name)) {
    throw new UnsentValidationError(
      `"${field}" name must not contain quotes, backslashes, angle brackets or control characters (they would corrupt the From header)`,
    );
  }
}

/**
 * Split `Name <a@b.com>` into its parts; validate objects and bare addresses.
 * Hand-written instead of a regex: the previous pattern backtracked cubically on long runs of spaces.
 */
export function parseAddress(value: Address, field: string): { email: string; name?: string } {
  if (value && typeof value === 'object') {
    const emailIn = value.email;
    const nameIn = value.name;
    if (typeof emailIn !== 'string' || !emailIn.trim()) {
      throw new UnsentValidationError(`"${field}.email" must be a non-empty string`);
    }
    if (nameIn !== undefined && nameIn !== null && typeof nameIn !== 'string') {
      throw new UnsentValidationError(`"${field}.name" must be a string`);
    }
    const email = emailIn.trim();
    checkMailbox(email, field);
    const name = typeof nameIn === 'string' && nameIn.trim() ? nameIn.trim() : undefined;
    if (name) checkName(name, field);
    return name ? { email, name } : { email };
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new UnsentValidationError(`"${field}" must be a non-empty string or { email, name }`);
  }
  const s = value.trim();
  let email = s;
  let name = '';
  if (s.endsWith('>')) {
    const lt = s.lastIndexOf('<');
    if (lt >= 0) {
      email = s.slice(lt + 1, -1).trim();
      name = s.slice(0, lt).trim();
      if (name.startsWith('"')) name = name.slice(1);
      if (name.endsWith('"')) name = name.slice(0, -1);
      name = name.trim();
    }
  }
  checkMailbox(email, field);
  if (name) checkName(name, field);
  return name ? { email, name } : { email };
}

/** Validate a recipient list and return it as a fresh array. */
export function normalizeRecipients(value: unknown, field: string, required: boolean): string[] | undefined {
  if (value === undefined || value === null) {
    if (required) throw new UnsentValidationError(`"${field}" is required`);
    return undefined;
  }
  let raw: unknown[];
  if (Array.isArray(value)) {
    const n = value.length;
    if (n > MAX_RECIPIENT_ARRAY) {
      throw new UnsentValidationError(`"${field}" has ${n} entries (maximum ${MAX_RECIPIENTS} addresses)`);
    }
    raw = [];
    for (let i = 0; i < n; i++) raw.push(value[i]);
  } else {
    raw = [value];
  }
  const cleaned: string[] = [];
  for (const v of raw) {
    if (v === undefined) continue; // array hole
    if (typeof v !== 'string') throw new UnsentValidationError(`"${field}" must be a string or an array of strings`);
    const t = v.trim();
    if (t) cleaned.push(t);
  }
  if (cleaned.length === 0) {
    if (required) throw new UnsentValidationError(`"${field}" must contain at least one address`);
    return undefined;
  }
  if (cleaned.length > MAX_RECIPIENTS) {
    throw new UnsentValidationError(`"${field}" has ${cleaned.length} addresses (maximum ${MAX_RECIPIENTS})`);
  }
  for (const addr of cleaned) checkMailbox(addr, field);
  return cleaned;
}

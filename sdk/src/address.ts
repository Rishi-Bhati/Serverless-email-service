import { UnsentValidationError } from './errors';
import type { Address } from './types';

const NAMED_RE = /^\s*"?([^"<>]*?)"?\s*<\s*([^<>\s]+)\s*>\s*$/;
export const MAX_RECIPIENTS = 100;

/** Split `Name <a@b.com>` into its parts; pass objects and bare addresses through. */
export function parseAddress(value: Address, field: string): { email: string; name?: string } {
  if (value && typeof value === 'object') {
    if (typeof value.email !== 'string' || !value.email.trim()) {
      throw new UnsentValidationError(`"${field}.email" must be a non-empty string`);
    }
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : undefined;
    return name ? { email: value.email.trim(), name } : { email: value.email.trim() };
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new UnsentValidationError(`"${field}" must be a non-empty string or { email, name }`);
  }
  const m = NAMED_RE.exec(value);
  if (m) {
    const name = (m[1] ?? '').trim();
    return name ? { email: m[2] as string, name } : { email: m[2] as string };
  }
  return { email: value.trim() };
}

/** Validate a recipient list and return it as an array. */
export function normalizeRecipients(value: string | string[] | undefined, field: string, required: boolean): string[] | undefined {
  if (value === undefined || value === null) {
    if (required) throw new UnsentValidationError(`"${field}" is required`);
    return undefined;
  }
  const list = (Array.isArray(value) ? value : [value]).map((v) => {
    if (typeof v !== 'string') throw new UnsentValidationError(`"${field}" must be a string or an array of strings`);
    return v.trim();
  });
  const cleaned = list.filter(Boolean);
  if (cleaned.length === 0) {
    if (required) throw new UnsentValidationError(`"${field}" must contain at least one address`);
    return undefined;
  }
  if (cleaned.length > MAX_RECIPIENTS) {
    throw new UnsentValidationError(`"${field}" has ${cleaned.length} addresses (maximum ${MAX_RECIPIENTS})`);
  }
  for (const addr of cleaned) {
    if (/[\r\n\0]/.test(addr)) throw new UnsentValidationError(`"${field}" contains a line break or NUL character`);
    if (!addr.includes('@')) throw new UnsentValidationError(`"${field}" contains an invalid address: ${JSON.stringify(addr)}`);
  }
  return cleaned;
}

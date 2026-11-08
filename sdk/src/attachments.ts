import { UnsentValidationError } from './errors';
import { MAX_REQUEST_BODY_BYTES } from './http';
import type { Attachment } from './types';

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
export const MAX_ATTACHMENTS = 20;
export const MAX_FILENAME_LENGTH = 255;
/** The server truncates longer MIME types. */
export const MAX_MIME_TYPE_LENGTH = 127;
/**
 * The server writes filenames into `Content-Type: ...; name="<filename>"` and `Content-Disposition` without
 * escaping, so quotes/backslashes would let a filename inject MIME parameters. Control characters (and the
 * Unicode line separators) never belong in a header.
 */
const BAD_FILENAME_RE = /["\\\x00-\x1f\x7f\u0085\u2028\u2029]/;
/** `type/subtype` (RFC 6838 restricted names) with optional `; token=token` parameters. Linear: delimiters are disjoint. */
const MIME_RE =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:[ \t]*;[ \t]*[A-Za-z0-9!#$&^_.+-]+=[A-Za-z0-9!#$&^_.+-]+)*$/;
/** Raw bytes whose base64 alone would exceed the request limit; rejected before encoding anything. */
const MAX_RAW_ATTACHMENT_BYTES = Math.floor((MAX_REQUEST_BODY_BYTES * 3) / 4);

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export interface WireAttachment {
  filename: string;
  content: string;
  mimeType?: string;
}

function tooLarge(at: string): UnsentValidationError {
  return new UnsentValidationError(
    `${at} is too large: the request limit is ${MAX_REQUEST_BODY_BYTES} bytes after base64 encoding (the server stores about 1.4 MB of raw attachment data per email)`,
    'payload_too_large',
  );
}

/** Validate one attachment and convert it to the API's wire format (base64 `content`). */
export async function toWireAttachment(att: Attachment, index: number): Promise<WireAttachment> {
  const at = `attachments[${index}]`;
  if (!att || typeof att !== 'object') throw new UnsentValidationError(`${at} must be an object`);

  // Read every field exactly once: a getter must not return one value for validation and another for the wire.
  const raw: unknown = att.content;
  const filenameIn: unknown = att.filename;
  const contentTypeIn: unknown = att.contentType;
  const mimeTypeIn: unknown = att.mimeType;
  const isBlob = typeof Blob !== 'undefined' && raw instanceof Blob;

  if (filenameIn !== undefined && filenameIn !== null && typeof filenameIn !== 'string') {
    throw new UnsentValidationError(`${at}.filename must be a string`);
  }
  let fileName = typeof filenameIn === 'string' ? filenameIn : '';
  if (!fileName && isBlob && 'name' in raw) {
    const blobName = (raw as Blob & { name?: unknown }).name;
    if (typeof blobName === 'string') fileName = blobName;
  }
  const filename = fileName.trim();
  if (!filename) throw new UnsentValidationError(`${at}.filename is required`);
  if (filename.length > MAX_FILENAME_LENGTH) throw new UnsentValidationError(`${at}.filename exceeds ${MAX_FILENAME_LENGTH} characters`);
  if (BAD_FILENAME_RE.test(filename)) {
    throw new UnsentValidationError(`${at}.filename must not contain quotes, backslashes, line breaks or other control characters`);
  }

  let mimeType: string | undefined;
  for (const [name, v] of [['contentType', contentTypeIn], ['mimeType', mimeTypeIn]] as const) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string') throw new UnsentValidationError(`${at}.${name} must be a string`);
    mimeType ??= v.trim();
  }
  if (mimeType === undefined && isBlob && typeof (raw as Blob).type === 'string' && (raw as Blob).type) mimeType = (raw as Blob).type;
  if (mimeType !== undefined) {
    if (mimeType.length > MAX_MIME_TYPE_LENGTH || !MIME_RE.test(mimeType)) {
      throw new UnsentValidationError(
        `${at}.contentType must be a MIME type such as "application/pdf" (at most ${MAX_MIME_TYPE_LENGTH} characters, no quotes or control characters)`,
      );
    }
  }

  let content: string;
  if (typeof raw === 'string') {
    if (raw.length > MAX_REQUEST_BODY_BYTES * 2) throw tooLarge(at);
    content = raw.replace(/\s+/g, '');
    if (content.length > MAX_REQUEST_BODY_BYTES) throw tooLarge(at);
    if (!content || content.length % 4 !== 0 || !BASE64_RE.test(content)) {
      throw new UnsentValidationError(
        `${at}.content is a string, so it must be valid base64. To attach text or binary data, pass a Uint8Array/Buffer (e.g. new TextEncoder().encode(text)).`,
      );
    }
  } else if (raw instanceof Uint8Array) {
    if (raw.byteLength > MAX_RAW_ATTACHMENT_BYTES) throw tooLarge(at);
    content = bytesToBase64(raw);
  } else if (raw instanceof ArrayBuffer) {
    if (raw.byteLength > MAX_RAW_ATTACHMENT_BYTES) throw tooLarge(at);
    content = bytesToBase64(new Uint8Array(raw));
  } else if (isBlob) {
    if ((raw as Blob).size > MAX_RAW_ATTACHMENT_BYTES) throw tooLarge(at);
    let buf: ArrayBuffer;
    try {
      buf = await (raw as Blob).arrayBuffer();
    } catch (cause) {
      throw new UnsentValidationError(`${at}.content (Blob) could not be read`, 'validation_error', cause);
    }
    if (!(buf instanceof ArrayBuffer)) throw new UnsentValidationError(`${at}.content (Blob) could not be read`);
    if (buf.byteLength > MAX_RAW_ATTACHMENT_BYTES) throw tooLarge(at);
    content = bytesToBase64(new Uint8Array(buf));
  } else {
    throw new UnsentValidationError(`${at}.content must be a base64 string, Uint8Array, Buffer, ArrayBuffer or Blob`);
  }
  if (!content) throw new UnsentValidationError(`${at}.content is empty`);

  return mimeType ? { filename, content, mimeType } : { filename, content };
}

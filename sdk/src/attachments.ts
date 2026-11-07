import { UnsentValidationError } from './errors';
import type { Attachment } from './types';

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
export const MAX_ATTACHMENTS = 20;

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

/** Validate one attachment and convert it to the API's wire format (base64 `content`). */
export async function toWireAttachment(att: Attachment, index: number): Promise<WireAttachment> {
  const at = `attachments[${index}]`;
  if (!att || typeof att !== 'object') throw new UnsentValidationError(`${at} must be an object`);

  const blobName =
    typeof Blob !== 'undefined' && att.content instanceof Blob && 'name' in att.content
      ? String((att.content as Blob & { name?: unknown }).name || '')
      : '';
  const filename = (att.filename ?? blobName).replace(/[\r\n\0]/g, '').trim();
  if (!filename) throw new UnsentValidationError(`${at}.filename is required`);
  if (filename.length > 255) throw new UnsentValidationError(`${at}.filename exceeds 255 characters`);

  let content: string;
  const raw = att.content;
  if (typeof raw === 'string') {
    content = raw.replace(/\s+/g, '');
    if (!content || content.length % 4 !== 0 || !BASE64_RE.test(content)) {
      throw new UnsentValidationError(
        `${at}.content is a string, so it must be valid base64. To attach text or binary data, pass a Uint8Array/Buffer (e.g. new TextEncoder().encode(text)).`,
      );
    }
  } else if (raw instanceof Uint8Array) {
    content = bytesToBase64(raw);
  } else if (raw instanceof ArrayBuffer) {
    content = bytesToBase64(new Uint8Array(raw));
  } else if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    content = bytesToBase64(new Uint8Array(await raw.arrayBuffer()));
  } else {
    throw new UnsentValidationError(`${at}.content must be a base64 string, Uint8Array, Buffer, ArrayBuffer or Blob`);
  }
  if (!content) throw new UnsentValidationError(`${at}.content is empty`);

  const mimeType = (att.contentType ?? att.mimeType ?? (typeof Blob !== 'undefined' && raw instanceof Blob ? raw.type : '')) || undefined;
  if (mimeType !== undefined && typeof mimeType !== 'string') {
    throw new UnsentValidationError(`${at}.contentType must be a string`);
  }
  return mimeType ? { filename, content, mimeType } : { filename, content };
}

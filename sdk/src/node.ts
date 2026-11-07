import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { Attachment } from './types';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ics': 'text/calendar',
};

/**
 * Node-only helper: read a file from disk as an attachment.
 *
 * ```ts
 * import { attachmentFromFile } from 'unsent-sdk/node';
 * await unsent.send({ ..., attachments: [await attachmentFromFile('./invoice.pdf')] });
 * ```
 */
export async function attachmentFromFile(
  path: string,
  options: { filename?: string; contentType?: string } = {},
): Promise<Attachment> {
  const content = await readFile(path);
  return {
    filename: options.filename ?? basename(path),
    content: new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
    contentType: options.contentType ?? MIME[extname(path).toLowerCase()],
  };
}

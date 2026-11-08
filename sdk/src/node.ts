import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { UnsentError, UnsentValidationError } from './errors';
import type { Attachment } from './types';

/** Largest file accepted: anything bigger cannot fit the server's 3 MiB request limit once base64-encoded. */
const MAX_FILE_BYTES = Math.floor((3 * 1024 * 1024 * 3) / 4);

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
  try {
    if (typeof path !== 'string' || !path || path.includes('\0')) throw new UnsentValidationError('attachmentFromFile() needs a file path string');
    if (options === undefined || options === null) options = {};
    if (typeof options !== 'object') throw new UnsentValidationError('attachmentFromFile() options must be an object');
    const filename: unknown = options.filename;
    const contentType: unknown = options.contentType;
    if (filename !== undefined && typeof filename !== 'string') throw new UnsentValidationError('filename must be a string');
    if (contentType !== undefined && typeof contentType !== 'string') throw new UnsentValidationError('contentType must be a string');

    // Open once and stat the handle (no TOCTOU between check and read). Refuse FIFOs, devices such as /dev/zero
    // and oversize files, which would otherwise block forever or exhaust memory.
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(path, 'r');
    } catch (cause) {
      throw new UnsentValidationError(`Could not open attachment file: ${(cause as NodeJS.ErrnoException)?.code ?? 'error'}`, 'invalid_attachment', cause);
    }
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new UnsentValidationError('Attachment path is not a regular file', 'invalid_attachment');
      if (st.size > MAX_FILE_BYTES) {
        throw new UnsentValidationError(`Attachment file is ${st.size} bytes; the maximum is ${MAX_FILE_BYTES}`, 'payload_too_large');
      }
      const buf = new Uint8Array(st.size);
      let read = 0;
      while (read < buf.length) {
        const { bytesRead } = await handle.read(buf, read, buf.length - read, read);
        if (bytesRead === 0) break;
        read += bytesRead;
      }
      return {
        filename: filename ?? basename(path),
        content: buf.subarray(0, read),
        contentType: contentType ?? MIME[extname(path).toLowerCase()],
      };
    } finally {
      await handle.close().catch(() => {});
    }
  } catch (err) {
    if (err instanceof UnsentError) throw err;
    throw new UnsentValidationError('Could not read attachment file', 'invalid_attachment', err);
  }
}

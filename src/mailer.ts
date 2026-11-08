/**
 * Single entry point for `worker-mailer`, with the blind-copy header removed.
 *
 * `worker-mailer` 1.2.x builds message headers in `Email#resolveBCC()`, which writes the blind-copied
 * addresses into the message as a literal `BCC:` header. The SMTP envelope is already correct — `rcpt()`
 * adds every to/cc/bcc address to `RCPT TO` — so that header is pure leakage: it shows the bcc list to
 * every recipient of the message.
 *
 * Upstream 1.3.1 drops the header, but it also replaced `btoa` with `Uint8Array.prototype.toBase64`,
 * which the workerd this project pins (1.20250718.0) does not implement; upgrading therefore breaks every
 * SMTP login with "toBase64 is not a function". Until the runtime can take 1.3.x, suppress the single
 * method that emits the header — delivery is unaffected because blind recipients still go in the envelope.
 *
 * Remove this shim once `worker-mailer` >= 1.3.1 runs on the deployed workerd.
 */
import { Email, WorkerMailer } from 'worker-mailer';

type BccResolver = () => void;

const proto = Email.prototype as unknown as { resolveBCC?: BccResolver };

// Only patch the versions that actually emit the header; a fixed release has no `resolveBCC`.
if (typeof proto.resolveBCC === 'function') {
  proto.resolveBCC = function resolveBCC(): void {
    // Blind recipients travel in the SMTP envelope, never in a header.
  };
}

export { WorkerMailer };

/**
 * Error types thrown by the SDK. Everything extends {@link UnsentError}, so
 * `catch (e) { if (e instanceof UnsentError) ... }` handles all SDK failures.
 *
 * Branch on `error.code` (stable) rather than `error.message` (may change).
 */

export class UnsentError extends Error {
  /** Stable machine-readable code, e.g. `invalid_api_key`, `validation_error`, `timeout`. */
  readonly code: string;
  /** Extra detail from the server (the API's `reason` field), when present. */
  readonly reason?: string;
  /** A short suggestion for fixing the problem, when the SDK knows one. */
  readonly hint?: string;

  constructor(
    message: string,
    options: { code: string; reason?: string; hint?: string; cause?: unknown },
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code;
    this.reason = options.reason;
    this.hint = options.hint;
  }
}

/** The client was constructed or called with invalid arguments. Nothing was sent. */
export class UnsentConfigError extends UnsentError {
  constructor(message: string, code = 'invalid_config') {
    super(message, { code });
  }
}

/** A request option failed client-side validation. Nothing was sent. */
export class UnsentValidationError extends UnsentError {
  constructor(message: string, code = 'validation_error') {
    super(message, { code });
  }
}

/** The request never produced an HTTP response (DNS, TLS, reset, offline...). */
export class UnsentConnectionError extends UnsentError {
  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { code: options.code ?? 'connection_error', cause: options.cause });
  }
}

/** The request exceeded `timeoutMs` (or `wait()` exceeded its deadline). */
export class UnsentTimeoutError extends UnsentConnectionError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { code: 'timeout', cause: options.cause });
  }
}

/** The server answered with an error status. */
export class UnsentAPIError extends UnsentError {
  /** HTTP status code. */
  readonly status: number;
  /** Parsed JSON error body (`{ error, code, reason? }`), or raw text when the body was not JSON. */
  readonly body: unknown;
  /** Server `id` for the conflicting email on idempotency conflicts. */
  readonly existingEmailId?: number;
  /** Delay requested by the server via `Retry-After`, in ms. */
  readonly retryAfterMs?: number;
  /** Server time (epoch ms) from the response `Date` header, when present. */
  readonly serverTimeMs?: number;

  constructor(
    message: string,
    options: {
      status: number;
      code: string;
      reason?: string;
      hint?: string;
      body?: unknown;
      existingEmailId?: number;
      retryAfterMs?: number;
      serverTimeMs?: number;
    },
  ) {
    super(message, options);
    this.status = options.status;
    this.body = options.body;
    this.existingEmailId = options.existingEmailId;
    this.retryAfterMs = options.retryAfterMs;
    this.serverTimeMs = options.serverTimeMs;
  }
}

/** 401: bad API key, bad signature, clock skew, replayed nonce... */
export class UnsentAuthenticationError extends UnsentAPIError {}
/** 403: the endpoint needs an admin dashboard session, which API keys cannot provide. */
export class UnsentPermissionError extends UnsentAPIError {}
/** 404: unknown email or route. */
export class UnsentNotFoundError extends UnsentAPIError {}
/** 409: the idempotency key was already used for a different email. */
export class UnsentConflictError extends UnsentAPIError {}
/** 400/413: the server rejected the request contents. */
export class UnsentRequestError extends UnsentAPIError {}
/** 429. */
export class UnsentRateLimitError extends UnsentAPIError {}
/** 5xx: server-side failure. Safe to retry when an idempotency key was used. */
export class UnsentServerError extends UnsentAPIError {}

const HINTS: Record<string, string> = {
  invalid_api_key: 'Check that apiKey matches the API_KEY secret of your Unsent deployment.',
  unauthorized: 'Check that apiKey matches the API_KEY secret of your Unsent deployment.',
  invalid_signature:
    'Check that apiSecret matches the API_SECRET secret of your Unsent deployment (no extra whitespace).',
  missing_signature:
    'The server requires signed requests. Pass apiSecret (UNSENT_API_SECRET) to the client.',
  nonce_reused: 'A nonce was replayed. This should not happen with the SDK; check for proxies that duplicate requests.',
  server_misconfigured: 'The Unsent server is missing configuration (API_KEY, API_SECRET, SECURITY_MODE or IDEMPOTENCY_TTL_HOURS). See the server logs.',
  unauthorized_sender:
    'The "from" address or providerId is not an active provider. Configure it in the dashboard, or omit "from" to use the default provider.',
  forbidden: 'This endpoint needs an admin dashboard session; API keys cannot call it.',
};

/** Build the right error class from an HTTP error response. */
export function apiErrorFromResponse(
  status: number,
  body: unknown,
  ctx: { hasApiSecret: boolean; retryAfterMs?: number; serverTimeMs?: number; statusText?: string },
): UnsentAPIError {
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : undefined;
  const code =
    typeof obj?.code === 'string' && obj.code
      ? obj.code
      : status >= 500
        ? 'internal_error'
        : `http_${status}`;
  const baseMessage =
    typeof obj?.error === 'string' && obj.error
      ? obj.error
      : typeof body === 'string' && body.trim()
        ? body.trim().slice(0, 200)
        : ctx.statusText || `HTTP ${status}`;
  const reason = typeof obj?.reason === 'string' ? obj.reason : undefined;

  let hint = HINTS[code];
  if (code === 'timestamp_skew') {
    hint = ctx.hasApiSecret
      ? 'Your system clock differs from the server by more than 3 minutes. Sync it (NTP).'
      : 'The server requires signed requests. Pass apiSecret (UNSENT_API_SECRET) to the client.';
  } else if (code === 'invalid_nonce' && !ctx.hasApiSecret) {
    hint = 'The server requires signed requests. Pass apiSecret (UNSENT_API_SECRET) to the client.';
  }

  let message = reason && !baseMessage.includes(reason) ? `${baseMessage}: ${reason}` : baseMessage;
  if (hint) message += ` (${hint})`;

  const existingEmailId = typeof obj?.id === 'number' ? obj.id : undefined;
  const opts = { status, code, reason, hint, body, existingEmailId, retryAfterMs: ctx.retryAfterMs, serverTimeMs: ctx.serverTimeMs };

  if (status === 401) return new UnsentAuthenticationError(message, opts);
  if (status === 403) return new UnsentPermissionError(message, opts);
  if (status === 404) return new UnsentNotFoundError(message, opts);
  if (status === 409) return new UnsentConflictError(message, opts);
  if (status === 429) return new UnsentRateLimitError(message, opts);
  if (status >= 500) return new UnsentServerError(message, opts);
  if (status === 400 || status === 413) return new UnsentRequestError(message, opts);
  return new UnsentAPIError(message, opts);
}

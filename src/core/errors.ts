/** Error thrown for every non-2xx response from a Lunnoa Automate deployment. */
export class LunnoaApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /** Parsed JSON error body when the server returned one, otherwise the raw text. */
  readonly body: unknown;
  /** HTTP method of the failed request. */
  readonly method: string;
  /** Path of the failed request (without the base URL). */
  readonly path: string;
  /** Present on definition-sync 409s when the server sends the current revision. */
  readonly currentRevision?: string;

  constructor(args: {
    status: number;
    body: unknown;
    method: string;
    path: string;
  }) {
    const detail = extractMessage(args.body);
    const currentRevision = extractCurrentRevision(args.body);
    const shown = [detail, currentRevision ? `currentRevision: ${currentRevision}` : undefined]
      .filter(Boolean)
      .join(' ');
    super(
      `Lunnoa API request failed: ${args.method} ${args.path} → ${args.status}${shown ? ` (${shown})` : ''}`,
    );
    this.name = 'LunnoaApiError';
    this.status = args.status;
    this.body = args.body;
    this.method = args.method;
    this.path = args.path;
    this.currentRevision = currentRevision;
  }

  /** True for 401 responses (missing, revoked, or expired credential). */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** True for 403 responses (missing permission or feature not licensed). */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True for 404 responses. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** True for 429 responses (rate limited). */
  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

export function publicApiMessage(error: LunnoaApiError): string {
  const message = extractMessage(error.body) ?? error.message;
  return error.currentRevision
    ? `${message} (currentRevision: ${error.currentRevision})`
    : message;
}

function extractCurrentRevision(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const revision = (body as Record<string, unknown>).currentRevision;
  return typeof revision === 'string' ? revision : undefined;
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const candidate = record.message ?? record.error;
    if (typeof candidate === 'string') {
      return candidate;
    }
    if (Array.isArray(candidate)) {
      return candidate.filter((m) => typeof m === 'string').join('; ');
    }
  }
  if (typeof body === 'string' && body.length > 0 && body.length < 300) {
    return body;
  }
  return undefined;
}

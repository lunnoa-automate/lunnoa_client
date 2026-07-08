import { API_KEY_PREFIX, assertApiKeyAllowedInEnvironment } from './auth';
import { LunnoaApiError } from './errors';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface LunnoaClientOptions {
  /**
   * Base URL of the Lunnoa Automate deployment, e.g. `https://lunnoa.acme.example`.
   * Paths are appended under `/api/*`.
   */
  baseUrl: string;
  /**
   * Server-side machine credential (`lna_...`). Never usable in browsers —
   * the constructor throws if one is supplied while `window` exists.
   */
  apiKey?: string;
  /**
   * User JWT obtained from the deployment's `/api/auth` or `/api/sso` login
   * flow. The supported credential for browser applications. May be a
   * function so refreshed tokens are picked up per request.
   */
  accessToken?: string | (() => string | Promise<string>);
  /** Custom fetch implementation (testing, polyfills, interceptors). */
  fetch?: FetchLike;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /**
   * Return the raw Response instead of parsing JSON. Used by the streaming
   * module and endpoints that may legitimately return 204.
   */
  raw?: boolean;
}

/**
 * Minimal typed HTTP layer shared by every resource namespace. Handles auth
 * header resolution, query serialisation, JSON parsing, and error mapping.
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly accessToken?: string | (() => string | Promise<string>);
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: LunnoaClientOptions) {
    if (!options.baseUrl) {
      throw new Error('LunnoaClient requires a baseUrl.');
    }
    if (!options.apiKey && !options.accessToken) {
      throw new Error(
        'LunnoaClient requires either an apiKey (server-side) or an accessToken (user JWT).',
      );
    }
    if (options.apiKey) {
      assertApiKeyAllowedInEnvironment(options.apiKey);
    }
    if (
      typeof options.accessToken === 'string' &&
      options.accessToken.startsWith(API_KEY_PREFIX)
    ) {
      throw new Error(
        'The accessToken option received an lna_ API key. API keys must be passed as `apiKey` ' +
          '(and never in a browser); accessToken is for user JWTs only.',
      );
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.fetchImpl =
      options.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    this.defaultHeaders = options.headers ?? {};
  }

  async resolveAuthHeader(): Promise<string> {
    if (this.apiKey) {
      return `Bearer ${this.apiKey}`;
    }
    const token =
      typeof this.accessToken === 'function'
        ? await this.accessToken()
        : this.accessToken;
    return `Bearer ${token}`;
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions & { raw: true },
  ): Promise<Response>;
  async request<T>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<T>;
  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<T | Response> {
    const url = this.buildUrl(path, options.query);
    const headers: Record<string, string> = {
      Authorization: await this.resolveAuthHeader(),
      ...this.defaultHeaders,
      ...options.headers,
    };

    const init: RequestInit = { method, headers, signal: options.signal };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, init);

    if (!response.ok) {
      const body = await parseBodySafely(response);
      throw new LunnoaApiError({
        status: response.status,
        body,
        method,
        path,
      });
    }

    if (options.raw) {
      return response;
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await parseBodySafely(response)) as T;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, options);
  }

  patch<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, options);
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }
}

async function parseBodySafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

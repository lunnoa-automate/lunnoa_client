import { API_KEY_PREFIX, assertApiKeyAllowedInEnvironment } from './auth';
import { LunnoaApiError } from './errors';
import type { TokenStore } from '../auth/token-store';

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
   * User JWT obtained from login / SSO. The supported credential for browser
   * applications. May be a function so refreshed tokens are picked up per request.
   *
   * Prefer {@link tokenStore} for Pattern B so login/refresh can persist tokens
   * and optionally auto-refresh on 401.
   */
  accessToken?: string | (() => string | Promise<string>);
  /**
   * Optional JWT store for Pattern B. When set, authenticated requests read
   * the access token from the store. Login / refresh helpers write back into it.
   */
  tokenStore?: TokenStore;
  /**
   * When true (default if `tokenStore` is set), a 401 triggers one
   * `POST /api/auth/refresh-token` attempt using the stored refresh token,
   * then retries the original request.
   */
  autoRefresh?: boolean;
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
  /**
   * Skip the Authorization header. Used for public auth endpoints
   * (login, refresh, SSO providers).
   */
  skipAuth?: boolean;
  /** Internal: set after an auto-refresh retry so we do not loop. */
  _retriedAfterRefresh?: boolean;
}

/**
 * Minimal typed HTTP layer shared by every resource namespace. Handles auth
 * header resolution, query serialisation, JSON parsing, and error mapping.
 */
export class HttpClient {
  readonly baseUrl: string;
  readonly tokenStore?: TokenStore;
  /** Underlying fetch (shared with AI SDK transports when needed). */
  readonly fetch: FetchLike;
  private readonly apiKey?: string;
  private readonly accessToken?: string | (() => string | Promise<string>);
  private readonly autoRefresh: boolean;
  private readonly defaultHeaders: Record<string, string>;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(options: LunnoaClientOptions) {
    if (!options.baseUrl) {
      throw new Error('LunnoaClient requires a baseUrl.');
    }
    if (!options.apiKey && !options.accessToken && !options.tokenStore) {
      throw new Error(
        'LunnoaClient requires an apiKey (server-side), an accessToken (user JWT), or a tokenStore (Pattern B).',
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
    this.tokenStore = options.tokenStore;
    this.autoRefresh =
      options.autoRefresh ?? Boolean(options.tokenStore && !options.apiKey);
    this.fetch =
      options.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    this.defaultHeaders = options.headers ?? {};
  }

  async resolveAuthHeader(): Promise<string> {
    if (this.apiKey) {
      return `Bearer ${this.apiKey}`;
    }
    if (this.tokenStore) {
      const fromStore = await this.tokenStore.getAccessToken();
      if (!fromStore) {
        throw new Error(
          'No access token in the token store. Call lunnoa.auth.login(...) first, ' +
            'or seed the store with setTokens / createMemoryTokenStore({ accessToken }).',
        );
      }
      return `Bearer ${fromStore}`;
    }
    const token =
      typeof this.accessToken === 'function'
        ? await this.accessToken()
        : this.accessToken;
    if (!token) {
      throw new Error('accessToken resolved to an empty value.');
    }
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
      ...this.defaultHeaders,
      ...options.headers,
    };

    if (!options.skipAuth) {
      headers.Authorization = await this.resolveAuthHeader();
    }

    const init: RequestInit = { method, headers, signal: options.signal };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await this.fetch(url, init);

    if (
      !response.ok &&
      response.status === 401 &&
      !options.skipAuth &&
      !options._retriedAfterRefresh &&
      this.autoRefresh &&
      this.tokenStore &&
      !this.apiKey
    ) {
      const refreshed = await this.tryRefreshAccessToken();
      if (refreshed) {
        return this.request<T>(method, path, {
          ...options,
          _retriedAfterRefresh: true,
        });
      }
    }

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

  /**
   * Single-flight refresh using the token store. Returns false when refresh
   * is impossible or fails (store is cleared on failure).
   */
  async tryRefreshAccessToken(): Promise<boolean> {
    if (!this.tokenStore) {
      return false;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.performRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<boolean> {
    const refreshToken = await this.tokenStore!.getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      const url = this.buildUrl('/api/auth/refresh-token');
      const response = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await this.tokenStore!.clear();
        return false;
      }
      const body = (await parseBodySafely(response)) as {
        access_token?: string;
      };
      if (!body?.access_token) {
        await this.tokenStore!.clear();
        return false;
      }
      await this.tokenStore!.setTokens({ accessToken: body.access_token });
      return true;
    } catch {
      await this.tokenStore!.clear();
      return false;
    }
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

import {
  createLocalStorageTokenStore,
  createMemoryTokenStore,
  type TokenStore,
} from './token-store';
import { LunnoaClient } from '../client';
import type { FetchLike } from '../core/http';

export interface CreateBrowserClientOptions {
  /** Base URL of the Lunnoa Automate deployment. */
  baseUrl: string;
  /**
   * JWT store. Defaults to `localStorage` keys `accessToken` / `refreshToken`
   * (same as the built-in Automate UI).
   */
  tokenStore?: TokenStore;
  /**
   * Retry once after `POST /api/auth/refresh-token` on 401.
   * Defaults to true.
   */
  autoRefresh?: boolean;
  fetch?: FetchLike;
  headers?: Record<string, string>;
}

/**
 * Browser (or isomorphic) client with JWT storage,
 * `lunnoa.auth.login` / refresh, and optional auto-refresh on 401.
 *
 * Never pass an `lna_` API key here.
 */
export function createBrowserClient(
  options: CreateBrowserClientOptions,
): LunnoaClient {
  const tokenStore =
    options.tokenStore ?? createLocalStorageTokenStore();
  return new LunnoaClient({
    baseUrl: options.baseUrl,
    tokenStore,
    autoRefresh: options.autoRefresh ?? true,
    fetch: options.fetch,
    headers: options.headers,
  });
}

export interface CreateServerClientOptions {
  /** Base URL of the Lunnoa Automate deployment. */
  baseUrl: string;
  /**
   * Workspace API key (`lna_...`) for operator scripts and the CLI.
   * Not an app login: people using an app authenticate as Lunnoa users.
   * Mutually exclusive with `accessToken` / `tokenStore`.
   */
  apiKey?: string;
  /**
   * User JWT (or getter) when the server already holds a signed-in Lunnoa user's token.
   */
  accessToken?: string | (() => string | Promise<string>);
  /** Optional store when the server holds both access and refresh tokens. */
  tokenStore?: TokenStore;
  autoRefresh?: boolean;
  fetch?: FetchLike;
  headers?: Record<string, string>;
}

/**
 * Node helper for a Lunnoa user JWT held on the server, or an `lna_` key for
 * operator scripts. App login uses {@link createBrowserClient}. Throws if
 * used with an API key in a browser.
 */
export function createServerClient(
  options: CreateServerClientOptions,
): LunnoaClient {
  if (!options.apiKey && !options.accessToken && !options.tokenStore) {
    throw new Error(
      'createServerClient requires apiKey, accessToken, or tokenStore.',
    );
  }
  return new LunnoaClient({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
    accessToken: options.accessToken,
    tokenStore: options.tokenStore,
    autoRefresh: options.autoRefresh,
    fetch: options.fetch,
    headers: options.headers,
  });
}

export { createLocalStorageTokenStore, createMemoryTokenStore };
export type { TokenStore };

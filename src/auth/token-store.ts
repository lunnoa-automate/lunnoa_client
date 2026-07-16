/**
 * Pluggable storage for Pattern B JWTs.
 * The SDK never uses httpOnly cookies: Automate auth is bearer JWT based.
 */
export interface TokenStore {
  getAccessToken(): string | null | Promise<string | null>;
  getRefreshToken(): string | null | Promise<string | null>;
  setTokens(tokens: {
    accessToken: string;
    refreshToken?: string;
  }): void | Promise<void>;
  clear(): void | Promise<void>;
}

/** In-memory store (SSR, tests, or short-lived server handlers). */
export function createMemoryTokenStore(
  initial?: { accessToken?: string; refreshToken?: string },
): TokenStore {
  let accessToken: string | null = initial?.accessToken ?? null;
  let refreshToken: string | null = initial?.refreshToken ?? null;

  return {
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    setTokens: (tokens) => {
      accessToken = tokens.accessToken;
      if (tokens.refreshToken !== undefined) {
        refreshToken = tokens.refreshToken;
      }
    },
    clear: () => {
      accessToken = null;
      refreshToken = null;
    },
  };
}

export interface LocalStorageTokenStoreOptions {
  /**
   * Defaults match the built-in Automate UI (`accessToken` / `refreshToken`)
   * so a custom portal can share a session with the product UI when desired.
   */
  accessTokenKey?: string;
  refreshTokenKey?: string;
  /**
   * Storage backend. Defaults to `globalThis.localStorage`.
   * Pass a mock in tests.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}

/**
 * Browser `localStorage` token store.
 * Throws if neither `options.storage` nor `globalThis.localStorage` is available.
 */
export function createLocalStorageTokenStore(
  options: LocalStorageTokenStoreOptions = {},
): TokenStore {
  const accessTokenKey = options.accessTokenKey ?? 'accessToken';
  const refreshTokenKey = options.refreshTokenKey ?? 'refreshToken';
  const storage =
    options.storage ??
    (typeof globalThis !== 'undefined'
      ? (globalThis as { localStorage?: Storage }).localStorage
      : undefined);

  if (!storage) {
    throw new Error(
      'createLocalStorageTokenStore requires localStorage (or a custom storage option). ' +
        'On the server, use createMemoryTokenStore or pass accessToken / apiKey instead.',
    );
  }

  return {
    getAccessToken: () => storage.getItem(accessTokenKey),
    getRefreshToken: () => storage.getItem(refreshTokenKey),
    setTokens: (tokens) => {
      storage.setItem(accessTokenKey, tokens.accessToken);
      if (tokens.refreshToken !== undefined) {
        storage.setItem(refreshTokenKey, tokens.refreshToken);
      }
    },
    clear: () => {
      storage.removeItem(accessTokenKey);
      storage.removeItem(refreshTokenKey);
    },
  };
}

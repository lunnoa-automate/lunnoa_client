import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  createBrowserClient,
  type CreateBrowserClientOptions,
} from '../auth/create-client';
import {
  isLoginRequires2FA,
  type CurrentUser,
  type LoginResult,
  type SsoProvidersResponse,
} from '../auth/types';
import type { LunnoaClient } from '../client';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface LunnoaAuthContextValue {
  /** Shared Lunnoa client (Pattern B token store). */
  client: LunnoaClient;
  /** Current user from `GET /api/users/me`, or null when signed out. */
  user: CurrentUser | null;
  /** Session bootstrap / mutation status. */
  status: AuthStatus;
  /** Last auth error message, if any. */
  error: string | null;
  /**
   * Password login. May return `{ requires2FA, sessionToken }` — then call
   * {@link verify2faLogin}. On success, refreshes `user`.
   */
  login: (input: {
    email: string;
    password: string;
  }) => Promise<LoginResult>;
  /** Completes password login when 2FA is required. */
  verify2faLogin: (input: {
    sessionToken: string;
    token: string;
  }) => Promise<CurrentUser>;
  /**
   * Exchanges an SSO / email-verification hidden JWT (from verify-token URL).
   */
  loginWithToken: (input: { token: string }) => Promise<CurrentUser>;
  /**
   * Returns the OIDC start URL for a provider. Navigate the browser there
   * (e.g. `window.location.assign(url)`).
   */
  getSsoLoginUrl: (providerId: string) => string;
  /** Lists public SSO providers for the login screen. */
  listSsoProviders: () => Promise<SsoProvidersResponse>;
  /** Clears the token store and local user state. */
  logout: () => Promise<void>;
  /** Re-fetches `auth.me()` when a session exists. */
  refreshUser: () => Promise<CurrentUser | null>;
  /** Current access token from the token store (for AI SDK headers, etc.). */
  getAccessToken: () => Promise<string | null>;
}

const LunnoaAuthContext = createContext<LunnoaAuthContextValue | null>(null);

export type LunnoaAuthProviderProps =
  | {
      /** Existing Pattern B client (from `createBrowserClient`). */
      client: LunnoaClient;
      children: ReactNode;
    }
  | (CreateBrowserClientOptions & {
      client?: undefined;
      children: ReactNode;
    });

function resolveClient(props: LunnoaAuthProviderProps): LunnoaClient {
  if ('client' in props && props.client) {
    return props.client;
  }
  const options = props as CreateBrowserClientOptions & { children: ReactNode };
  if (!options.baseUrl) {
    throw new Error(
      'LunnoaAuthProvider requires either a `client` or a `baseUrl` to create one.',
    );
  }
  return createBrowserClient({
    baseUrl: options.baseUrl,
    tokenStore: options.tokenStore,
    autoRefresh: options.autoRefresh,
    fetch: options.fetch,
    headers: options.headers,
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Authentication failed';
}

/**
 * Provides a Pattern B Lunnoa client and session helpers to React trees.
 *
 * ```tsx
 * <LunnoaAuthProvider baseUrl={import.meta.env.VITE_LUNNOA_URL}>
 *   <App />
 * </LunnoaAuthProvider>
 * ```
 */
export function LunnoaAuthProvider(props: LunnoaAuthProviderProps) {
  const client = useMemo(() => resolveClient(props), [
    // Stable when caller passes the same client instance or baseUrl.
    'client' in props && props.client ? props.client : null,
    !('client' in props && props.client)
      ? (props as CreateBrowserClientOptions).baseUrl
      : null,
  ]);

  const [user, setUser] = useState<CurrentUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState<string | null>(null);

  const refreshUser = useCallback(async (): Promise<CurrentUser | null> => {
    const hasSession = await client.auth.hasSession();
    if (!hasSession) {
      setUser(null);
      setStatus('unauthenticated');
      return null;
    }
    try {
      const me = await client.auth.me();
      setUser(me);
      setStatus('authenticated');
      setError(null);
      return me;
    } catch (err) {
      await client.auth.logout();
      setUser(null);
      setStatus('unauthenticated');
      setError(errorMessage(err));
      return null;
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setStatus('loading');
      const hasSession = await client.auth.hasSession();
      if (cancelled) return;
      if (!hasSession) {
        setUser(null);
        setStatus('unauthenticated');
        return;
      }
      try {
        const me = await client.auth.me();
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
        setError(null);
      } catch (err) {
        if (cancelled) return;
        await client.auth.logout();
        setUser(null);
        setStatus('unauthenticated');
        setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      setError(null);
      try {
        const result = await client.auth.login(input);
        if (!isLoginRequires2FA(result)) {
          const me = await client.auth.me();
          setUser(me);
          setStatus('authenticated');
        }
        return result;
      } catch (err) {
        setError(errorMessage(err));
        throw err;
      }
    },
    [client],
  );

  const verify2faLogin = useCallback(
    async (input: { sessionToken: string; token: string }) => {
      setError(null);
      try {
        await client.auth.verify2faLogin(input);
        const me = await client.auth.me();
        setUser(me);
        setStatus('authenticated');
        return me;
      } catch (err) {
        setError(errorMessage(err));
        throw err;
      }
    },
    [client],
  );

  const loginWithToken = useCallback(
    async (input: { token: string }) => {
      setError(null);
      try {
        await client.auth.loginWithToken(input);
        const me = await client.auth.me();
        setUser(me);
        setStatus('authenticated');
        return me;
      } catch (err) {
        setError(errorMessage(err));
        throw err;
      }
    },
    [client],
  );

  const logout = useCallback(async () => {
    setError(null);
    await client.auth.logout();
    setUser(null);
    setStatus('unauthenticated');
  }, [client]);

  const getSsoLoginUrl = useCallback(
    (providerId: string) => client.auth.sso.getLoginUrl(providerId),
    [client],
  );

  const listSsoProviders = useCallback(
    () => client.auth.sso.listProviders(),
    [client],
  );

  const getAccessToken = useCallback(async () => {
    const store = client.http.tokenStore;
    if (!store) return null;
    return store.getAccessToken();
  }, [client]);

  const value = useMemo<LunnoaAuthContextValue>(
    () => ({
      client,
      user,
      status,
      error,
      login,
      verify2faLogin,
      loginWithToken,
      getSsoLoginUrl,
      listSsoProviders,
      logout,
      refreshUser,
      getAccessToken,
    }),
    [
      client,
      user,
      status,
      error,
      login,
      verify2faLogin,
      loginWithToken,
      getSsoLoginUrl,
      listSsoProviders,
      logout,
      refreshUser,
      getAccessToken,
    ],
  );

  return createElement(LunnoaAuthContext.Provider, { value }, props.children);
}

function useAuthContext(hookName: string): LunnoaAuthContextValue {
  const ctx = useContext(LunnoaAuthContext);
  if (!ctx) {
    throw new Error(`${hookName} must be used within a <LunnoaAuthProvider>.`);
  }
  return ctx;
}

/** Full auth session API for Pattern B React apps. */
export function useLunnoaAuth(): LunnoaAuthContextValue {
  return useAuthContext('useLunnoaAuth');
}

/** The Lunnoa client from the nearest {@link LunnoaAuthProvider}. */
export function useLunnoaClient(): LunnoaClient {
  return useAuthContext('useLunnoaClient').client;
}

/**
 * Current access token from the provider's token store.
 * Useful for AI SDK `useChat` / `DefaultChatTransport` Authorization headers.
 */
export function useAccessToken(): {
  getAccessToken: () => Promise<string | null>;
  status: AuthStatus;
} {
  const { getAccessToken, status } = useAuthContext('useAccessToken');
  return { getAccessToken, status };
}

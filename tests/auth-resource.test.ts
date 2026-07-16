import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserClient,
  createMemoryTokenStore,
  createServerClient,
  isLoginRequires2FA,
} from '../src';
import { LunnoaClient } from '../src/client';
import { FAKE_API_KEY, FAKE_JWT } from './fixtures';

function mockFetchSequence(
  handlers: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>,
) {
  let i = 0;
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const handler = handlers[i++];
    if (!handler) {
      throw new Error(`Unexpected fetch #${i} to ${url}`);
    }
    return handler(url, init);
  });
}

describe('auth.login / refresh / me', () => {
  it('logs in, stores tokens, and calls me with Bearer', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      () =>
        Response.json({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
        }),
      (url, init) => {
        expect(url).toContain('/api/users/me');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer access-1',
        });
        return Response.json({
          id: 'u1',
          email: 'a@b.c',
          name: 'Ada',
        });
      },
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    const result = await lunnoa.auth.login({
      email: 'a@b.c',
      password: 'secret',
    });
    expect(isLoginRequires2FA(result)).toBe(false);
    if (!isLoginRequires2FA(result)) {
      expect(result.accessToken).toBe('access-1');
      expect(result.refreshToken).toBe('refresh-1');
    }
    expect(await store.getAccessToken()).toBe('access-1');
    expect(await store.getRefreshToken()).toBe('refresh-1');

    const me = await lunnoa.auth.me();
    expect(me.email).toBe('a@b.c');
  });

  it('returns requires2FA without storing tokens', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      () =>
        Response.json({
          requires2FA: true,
          sessionToken: 'sess-1',
        }),
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    const result = await lunnoa.auth.login({
      email: 'a@b.c',
      password: 'secret',
    });
    expect(isLoginRequires2FA(result)).toBe(true);
    expect(await store.getAccessToken()).toBeNull();
  });

  it('completes 2FA login and stores tokens', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      (url, init) => {
        expect(url).toContain('/api/auth/2fa/verify-login');
        expect(JSON.parse(String(init?.body))).toEqual({
          sessionToken: 'sess-1',
          token: '123456',
        });
        return Response.json({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
        });
      },
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    const tokens = await lunnoa.auth.verify2faLogin({
      sessionToken: 'sess-1',
      token: '123456',
    });
    expect(tokens.accessToken).toBe('access-2');
    expect(await store.getAccessToken()).toBe('access-2');
  });

  it('exchanges hidden SSO token via loginWithToken', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      (url) => {
        expect(url).toContain('/api/auth/login-with-token');
        return Response.json({
          access_token: 'access-sso',
          refresh_token: 'refresh-sso',
        });
      },
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    await lunnoa.auth.loginWithToken({ token: 'hidden-jwt' });
    expect(await store.getAccessToken()).toBe('access-sso');
  });

  it('lists SSO providers and builds login URL without Authorization', async () => {
    const fetchImpl = mockFetchSequence([
      (url, init) => {
        expect(url).toContain('/api/auth/sso/providers');
        expect(
          (init?.headers as Record<string, string> | undefined)?.Authorization,
        ).toBeUndefined();
        return Response.json({
          providers: [{ id: 'p1', name: 'Okta', buttonLabel: 'Okta' }],
          passwordAuthDisabled: false,
          googleAuthDisabled: true,
          ssoEnforced: false,
        });
      },
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: createMemoryTokenStore(),
      fetch: fetchImpl,
    });

    const providers = await lunnoa.auth.sso.listProviders();
    expect(providers.providers[0]?.id).toBe('p1');
    expect(lunnoa.auth.sso.getLoginUrl('p1')).toBe(
      'https://lunnoa.example/api/auth/sso/p1/login',
    );
  });

  it('logout clears the token store only', async () => {
    const store = createMemoryTokenStore({
      accessToken: 'a',
      refreshToken: 'r',
    });
    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: vi.fn(),
    });
    await lunnoa.auth.logout();
    expect(await store.getAccessToken()).toBeNull();
    expect(await store.getRefreshToken()).toBeNull();
  });
});

describe('auto-refresh on 401', () => {
  it('refreshes once and retries the original request', async () => {
    const store = createMemoryTokenStore({
      accessToken: 'stale',
      refreshToken: 'refresh-1',
    });

    const fetchImpl = mockFetchSequence([
      (url, init) => {
        expect(url).toContain('/api/users/me');
        expect(
          (init?.headers as Record<string, string>).Authorization,
        ).toBe('Bearer stale');
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
        });
      },
      (url, init) => {
        expect(url).toContain('/api/auth/refresh-token');
        expect(JSON.parse(String(init?.body))).toEqual({
          refreshToken: 'refresh-1',
        });
        return Response.json({ access_token: 'fresh' });
      },
      (url, init) => {
        expect(url).toContain('/api/users/me');
        expect(
          (init?.headers as Record<string, string>).Authorization,
        ).toBe('Bearer fresh');
        return Response.json({ id: 'u1', email: 'a@b.c', name: null });
      },
    ]);

    const lunnoa = new LunnoaClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      autoRefresh: true,
      fetch: fetchImpl,
    });

    const me = await lunnoa.auth.me();
    expect(me.id).toBe('u1');
    expect(await store.getAccessToken()).toBe('fresh');
    expect(await store.getRefreshToken()).toBe('refresh-1');
  });
});

describe('createBrowserClient / createServerClient', () => {
  const globalAny = globalThis as Record<string, unknown>;

  afterEach(() => {
    delete globalAny.window;
    delete globalAny.localStorage;
  });

  it('createBrowserClient uses a provided token store', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      () =>
        Response.json({
          access_token: 'a',
          refresh_token: 'r',
        }),
    ]);
    const lunnoa = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });
    await lunnoa.auth.login({ email: 'a@b.c', password: 'x' });
    expect(await store.getAccessToken()).toBe('a');
  });

  it('createServerClient accepts apiKey', () => {
    expect(() =>
      createServerClient({
        baseUrl: 'https://lunnoa.example',
        apiKey: FAKE_API_KEY,
      }),
    ).not.toThrow();
  });

  it('createServerClient accepts accessToken', () => {
    expect(() =>
      createServerClient({
        baseUrl: 'https://lunnoa.example',
        accessToken: FAKE_JWT,
      }),
    ).not.toThrow();
  });
});

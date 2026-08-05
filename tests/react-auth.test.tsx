/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createBrowserClient,
  createMemoryTokenStore,
  isLoginRequires2FA,
} from '../src';
import {
  LunnoaAuthProvider,
  useAccessToken,
  useLunnoaAuth,
  useLunnoaClient,
} from '../src/react';

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

describe('LunnoaAuthProvider', () => {
  it('bootstraps unauthenticated when the store is empty', async () => {
    const store = createMemoryTokenStore();
    const client = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: vi.fn(),
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LunnoaAuthProvider, { client, children });

    const { result } = renderHook(() => useLunnoaAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('unauthenticated');
    });
    expect(result.current.user).toBeNull();
    expect(useLunnoaClient).toBeDefined();
  });

  it('logs in and exposes user + access token', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      () =>
        Response.json({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
        }),
      () =>
        Response.json({
          id: 'u1',
          email: 'ada@example.com',
          name: 'Ada',
        }),
    ]);

    const client = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LunnoaAuthProvider, { client, children });

    const { result } = renderHook(
      () => ({
        auth: useLunnoaAuth(),
        token: useAccessToken(),
        client: useLunnoaClient(),
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.auth.status).toBe('unauthenticated');
    });

    await act(async () => {
      const loginResult = await result.current.auth.login({
        email: 'ada@example.com',
        password: 'secret',
      });
      expect(isLoginRequires2FA(loginResult)).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.auth.status).toBe('authenticated');
    });
    expect(result.current.auth.user?.email).toBe('ada@example.com');
    expect(result.current.client).toBe(client);
    await expect(result.current.token.getAccessToken()).resolves.toBe('access-1');
  });

  it('handles 2FA challenge then verify2faLogin', async () => {
    const store = createMemoryTokenStore();
    const fetchImpl = mockFetchSequence([
      () =>
        Response.json({
          requires2FA: true,
          sessionToken: 'sess-1',
        }),
      () =>
        Response.json({
          access_token: 'access-2',
          refresh_token: 'refresh-2',
        }),
      () =>
        Response.json({
          id: 'u2',
          email: 'ada@example.com',
          name: 'Ada',
        }),
    ]);

    const client = createBrowserClient({
      baseUrl: 'https://lunnoa.example',
      tokenStore: store,
      fetch: fetchImpl,
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(LunnoaAuthProvider, { client, children });

    const { result } = renderHook(() => useLunnoaAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('unauthenticated');
    });

    let sessionToken = '';
    await act(async () => {
      const loginResult = await result.current.login({
        email: 'ada@example.com',
        password: 'secret',
      });
      expect(isLoginRequires2FA(loginResult)).toBe(true);
      if (isLoginRequires2FA(loginResult)) {
        sessionToken = loginResult.sessionToken;
      }
    });

    expect(result.current.status).toBe('unauthenticated');

    await act(async () => {
      await result.current.verify2faLogin({
        sessionToken,
        token: '123456',
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('authenticated');
    });
    expect(result.current.user?.id).toBe('u2');
  });

  it('throws when hooks are used outside the provider', () => {
    expect(() => renderHook(() => useLunnoaAuth())).toThrow(
      /LunnoaAuthProvider/,
    );
  });
});

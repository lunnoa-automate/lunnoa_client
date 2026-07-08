import { afterEach, describe, expect, it } from 'vitest';

import { LunnoaClient } from '../src/client';
import {
  assertApiKeyAllowedInEnvironment,
  isBrowserEnvironment,
} from '../src/core/auth';
import { FAKE_API_KEY, FAKE_JWT } from './fixtures';

const globalAny = globalThis as Record<string, unknown>;

afterEach(() => {
  delete globalAny.window;
});

describe('browser API-key guard', () => {
  it('allows lna_ keys in a server environment', () => {
    expect(isBrowserEnvironment()).toBe(false);
    expect(() => assertApiKeyAllowedInEnvironment(FAKE_API_KEY)).not.toThrow();
  });

  it('throws when an lna_ key is used while window exists', () => {
    globalAny.window = {};
    expect(() => assertApiKeyAllowedInEnvironment(FAKE_API_KEY)).toThrow(
      /browser/i,
    );
  });

  it('LunnoaClient constructor throws for apiKey in a browser environment', () => {
    globalAny.window = {};
    expect(
      () =>
        new LunnoaClient({
          baseUrl: 'https://lunnoa.example',
          apiKey: FAKE_API_KEY,
        }),
    ).toThrow(/browser/i);
  });

  it('LunnoaClient allows accessToken (user JWT) in a browser environment', () => {
    globalAny.window = {};
    expect(
      () =>
        new LunnoaClient({
          baseUrl: 'https://lunnoa.example',
          accessToken: FAKE_JWT,
        }),
    ).not.toThrow();
  });

  it('rejects non-lna_ values passed as apiKey', () => {
    expect(
      () =>
        new LunnoaClient({
          baseUrl: 'https://lunnoa.example',
          apiKey: FAKE_JWT,
        }),
    ).toThrow(/lna_/);
  });

  it('rejects lna_ keys smuggled through accessToken', () => {
    expect(
      () =>
        new LunnoaClient({
          baseUrl: 'https://lunnoa.example',
          accessToken: FAKE_API_KEY,
        }),
    ).toThrow(/apiKey/);
  });

  it('requires some credential', () => {
    expect(
      () => new LunnoaClient({ baseUrl: 'https://lunnoa.example' }),
    ).toThrow(/apiKey|accessToken/);
  });
});

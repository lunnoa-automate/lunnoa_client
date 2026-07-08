/** Prefix of Lunnoa Automate machine (service-account) API keys. */
export const API_KEY_PREFIX = 'lna_';

/** Returns true when running inside a browser (or browser-like) environment. */
export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined';
}

/**
 * API keys are server-to-server credentials. Shipping one to a browser exposes
 * the whole workspace the key is scoped to, so the SDK refuses outright.
 *
 * Browser apps must authenticate end users with a Lunnoa user JWT (Pattern B)
 * or proxy through their own backend which holds the key (Pattern A / BFF).
 */
export function assertApiKeyAllowedInEnvironment(apiKey: string): void {
  if (isBrowserEnvironment()) {
    throw new Error(
      'Refusing to use a Lunnoa API key (lna_...) in a browser environment. ' +
        'API keys are server-side credentials: anyone opening dev tools could read the key ' +
        'and act as the service account across its whole workspace. ' +
        'Either call the Lunnoa API from your own backend which holds the key (backend-for-frontend pattern), ' +
        'or authenticate the end user with a Lunnoa user JWT and pass it as `accessToken`.',
    );
  }
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new Error(
      `Invalid Lunnoa API key: expected it to start with "${API_KEY_PREFIX}". ` +
        'If you are passing a user JWT, use the `accessToken` option instead of `apiKey`.',
    );
  }
}

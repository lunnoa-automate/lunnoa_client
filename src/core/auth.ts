/** Prefix of Lunnoa Automate machine (service-account) API keys. */
export const API_KEY_PREFIX = 'lna_';

/** Returns true when running inside a browser (or browser-like) environment. */
export function isBrowserEnvironment(): boolean {
  return typeof window !== 'undefined';
}

/**
 * API keys are operator credentials (CLI, codegen, deploy). Shipping one to a
 * browser exposes the whole workspace the key is scoped to, so the SDK refuses.
 *
 * Apps authenticate end users with a Lunnoa user JWT.
 */
export function assertApiKeyAllowedInEnvironment(apiKey: string): void {
  if (isBrowserEnvironment()) {
    throw new Error(
      'Refusing to use a Lunnoa API key (lna_...) in a browser environment. ' +
        'API keys are for the CLI and operator scripts, not for app login. ' +
        'Anyone opening dev tools could read the key and act as the service account across its whole workspace. ' +
        'Sign the end user in with lunnoa.auth.login and pass their JWT as `accessToken`.',
    );
  }
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    throw new Error(
      `Invalid Lunnoa API key: expected it to start with "${API_KEY_PREFIX}". ` +
        'If you are passing a user JWT, use the `accessToken` option instead of `apiKey`.',
    );
  }
}

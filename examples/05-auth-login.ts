/**
 * Pattern B: password login, optional 2FA, session me(), logout.
 *
 * Usage:
 *   LUNNOA_URL=https://… LUNNOA_EMAIL=… LUNNOA_PASSWORD=… \
 *     npx tsx examples/05-auth-login.ts
 */
import {
  createMemoryTokenStore,
  isLoginRequires2FA,
  LunnoaClient,
} from '../src';

const baseUrl = process.env.LUNNOA_URL;
const email = process.env.LUNNOA_EMAIL;
const password = process.env.LUNNOA_PASSWORD;

if (!baseUrl || !email || !password) {
  console.error(
    'Set LUNNOA_URL, LUNNOA_EMAIL, and LUNNOA_PASSWORD before running this example.',
  );
  process.exit(1);
}

const lunnoa = new LunnoaClient({
  baseUrl,
  tokenStore: createMemoryTokenStore(),
});

const result = await lunnoa.auth.login({ email, password });

if (isLoginRequires2FA(result)) {
  const code = process.env.LUNNOA_2FA_CODE;
  if (!code) {
    console.error(
      'Account requires 2FA. Re-run with LUNNOA_2FA_CODE set to a TOTP or backup code.',
    );
    process.exit(1);
  }
  await lunnoa.auth.verify2faLogin({
    sessionToken: result.sessionToken,
    token: code,
  });
}

const me = await lunnoa.auth.me();
console.log('Signed in as', me.email, `(${me.id})`);

await lunnoa.auth.logout();
console.log('Local session cleared.');

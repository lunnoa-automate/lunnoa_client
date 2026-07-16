import {
  isLoginRequires2FA,
  mapLoginWire,
  mapWireTokens,
  type AuthTokens,
  type CurrentUser,
  type LoginResult,
  type LoginWireResponse,
  type RefreshWireResponse,
  type SsoProvidersResponse,
} from '../auth/types';
import type { TokenStore } from '../auth/token-store';
import type { HttpClient } from '../core/http';

/**
 * Login, refresh, SSO discovery, and session helpers for Pattern B.
 *
 * Password login, token exchange, refresh, and SSO provider listing are
 * **public** endpoints (no Bearer). `me()` requires a user JWT.
 *
 * There is no server logout endpoint: {@link AuthResource.logout} only clears
 * the configured {@link TokenStore}.
 */
export class AuthResource {
  readonly sso: SsoAuthResource;

  constructor(
    private readonly http: HttpClient,
    private readonly tokenStore?: TokenStore,
  ) {
    this.sso = new SsoAuthResource(http);
  }

  /**
   * `POST /api/auth/login`
   *
   * On success without 2FA, tokens are written to the token store (when set).
   * When 2FA is required, returns `{ requires2FA, sessionToken }` and does not
   * store tokens until {@link verify2faLogin} succeeds.
   */
  async login(input: {
    email: string;
    password: string;
  }): Promise<LoginResult> {
    const wire = await this.http.post<LoginWireResponse>('/api/auth/login', {
      body: { email: input.email, password: input.password },
      skipAuth: true,
    });
    const result = mapLoginWire(wire);
    if (!isLoginRequires2FA(result)) {
      await this.persistTokens(result);
    }
    return result;
  }

  /**
   * `POST /api/auth/2fa/verify-login`
   *
   * Completes password login after TOTP or backup-code verification.
   */
  async verify2faLogin(input: {
    sessionToken: string;
    token: string;
  }): Promise<AuthTokens> {
    const wire = await this.http.post<LoginWireResponse>(
      '/api/auth/2fa/verify-login',
      {
        body: {
          sessionToken: input.sessionToken,
          token: input.token,
        },
        skipAuth: true,
      },
    );
    const result = mapLoginWire(wire);
    if (isLoginRequires2FA(result)) {
      throw new Error(
        'Unexpected 2FA challenge after verify2faLogin; expected access and refresh tokens.',
      );
    }
    await this.persistTokens(result);
    return result;
  }

  /**
   * `POST /api/auth/login-with-token`
   *
   * Exchanges a short-lived hidden JWT (SSO callback or email verification)
   * for access and refresh tokens.
   */
  async loginWithToken(input: { token: string }): Promise<AuthTokens> {
    const wire = await this.http.post<{
      access_token: string;
      refresh_token: string;
    }>('/api/auth/login-with-token', {
      body: { token: input.token },
      skipAuth: true,
    });
    const tokens: AuthTokens = {
      accessToken: wire.access_token,
      refreshToken: wire.refresh_token,
    };
    await this.persistTokens(tokens);
    return tokens;
  }

  /**
   * `POST /api/auth/refresh-token`
   *
   * Returns a new access token. The refresh token itself is not rotated.
   * When a token store is configured and `refreshToken` is omitted, the
   * stored refresh token is used.
   */
  async refresh(input?: { refreshToken?: string }): Promise<{
    accessToken: string;
  }> {
    const refreshToken =
      input?.refreshToken ?? (await this.tokenStore?.getRefreshToken()) ?? null;
    if (!refreshToken) {
      throw new Error(
        'auth.refresh requires a refreshToken argument or a token store that holds one.',
      );
    }

    const wire = await this.http.post<RefreshWireResponse>(
      '/api/auth/refresh-token',
      {
        body: { refreshToken },
        skipAuth: true,
      },
    );
    const mapped = mapWireTokens(wire);
    if (this.tokenStore) {
      await this.tokenStore.setTokens({
        accessToken: mapped.accessToken,
        // Keep existing refresh token; refresh responses omit it.
        refreshToken: mapped.refreshToken,
      });
    }
    return { accessToken: mapped.accessToken };
  }

  /**
   * `GET /api/users/me` — current user profile for the active JWT.
   */
  me(): Promise<CurrentUser> {
    return this.http.get<CurrentUser>('/api/users/me');
  }

  /**
   * Clears tokens from the token store.
   * There is no server-side logout endpoint; access tokens remain valid until expiry
   * (or until the user's `tokensValidFrom` watermark invalidates them).
   */
  async logout(): Promise<void> {
    await this.tokenStore?.clear();
  }

  /** True when the token store has an access token (sync stores only wait on Promise). */
  async hasSession(): Promise<boolean> {
    const token = await this.tokenStore?.getAccessToken();
    return Boolean(token);
  }

  private async persistTokens(tokens: AuthTokens): Promise<void> {
    if (!this.tokenStore) {
      return;
    }
    await this.tokenStore.setTokens({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }
}

/**
 * SSO discovery and login URL helpers.
 *
 * Browser SSO callbacks redirect to the deployment's `CLIENT_URL/verify-token`,
 * not to an arbitrary custom origin. Custom portals typically complete the
 * exchange with {@link AuthResource.loginWithToken} after receiving the hidden
 * token (for example via a BFF that can see the verify-token page, or by
 * setting `CLIENT_URL` to the custom app).
 */
export class SsoAuthResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /api/auth/sso/providers` (public). */
  listProviders(): Promise<SsoProvidersResponse> {
    return this.http.get<SsoProvidersResponse>('/api/auth/sso/providers', {
      skipAuth: true,
    });
  }

  /**
   * Absolute URL for `GET /api/auth/sso/:providerId/login`.
   * Navigate the browser here to start the OIDC redirect.
   */
  getLoginUrl(providerId: string): string {
    if (!providerId) {
      throw new Error('sso.getLoginUrl requires a providerId.');
    }
    return this.http.buildUrl(
      `/api/auth/sso/${encodeURIComponent(providerId)}/login`,
    );
  }
}

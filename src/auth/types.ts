/**
 * Tokens returned by login / 2FA / login-with-token.
 * Mapped from the wire format (`access_token` / `refresh_token`).
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Successful password login without 2FA, or after 2FA / token exchange. */
export type LoginSuccess = AuthTokens;

/**
 * Password login when the user has 2FA enabled.
 * Call {@link AuthResource.verify2faLogin} with the session token and TOTP/backup code.
 */
export interface LoginRequires2FA {
  requires2FA: true;
  sessionToken: string;
}

export type LoginResult = LoginSuccess | LoginRequires2FA;

export function isLoginRequires2FA(
  result: LoginResult,
): result is LoginRequires2FA {
  return 'requires2FA' in result && result.requires2FA === true;
}

/** Wire payload from `POST /api/auth/login` (and related). */
export type LoginWireResponse =
  | {
      access_token: string;
      refresh_token: string;
    }
  | {
      requires2FA: true;
      sessionToken: string;
    };

/** Wire payload from `POST /api/auth/refresh-token`. */
export interface RefreshWireResponse {
  access_token: string;
  refresh_token?: string;
}

/** Public SSO discovery from `GET /api/auth/sso/providers`. */
export interface SsoProvidersResponse {
  providers: SsoProviderSummary[];
  passwordAuthDisabled: boolean;
  googleAuthDisabled: boolean;
  ssoEnforced: boolean;
}

export interface SsoProviderSummary {
  id: string;
  name: string;
  buttonLabel: string | null;
}

/**
 * Current user from `GET /api/users/me`.
 * Password is never returned.
 */
export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  createdAt?: string;
  updatedAt?: string;
  rootProfileImageUrl?: string | null;
  emailVerifiedAt?: string | null;
  toursCompleted?: unknown;
  hasPassword?: boolean;
  ssoProviders?: string[];
}

export function mapWireTokens(wire: {
  access_token: string;
  refresh_token?: string;
}): { accessToken: string; refreshToken?: string } {
  return {
    accessToken: wire.access_token,
    ...(wire.refresh_token !== undefined
      ? { refreshToken: wire.refresh_token }
      : {}),
  };
}

export function mapLoginWire(wire: LoginWireResponse): LoginResult {
  if ('requires2FA' in wire && wire.requires2FA) {
    return {
      requires2FA: true,
      sessionToken: wire.sessionToken,
    };
  }
  const tokens = wire as { access_token: string; refresh_token: string };
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  };
}

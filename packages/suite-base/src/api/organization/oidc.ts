// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Browser side of OpenID Connect login: Authorization Code flow with PKCE, token refresh and
// logout. Lichtblick has no login screens of its own; the identity provider named by the
// organization API does that.

import Logger from "@lichtblick/log";

import { Schemas } from "./client";

const log = Logger.getLogger(__filename);

const TOKENS_KEY = "lichtblick.organization.tokens";
const PENDING_KEY = "lichtblick.organization.pendingLogin";
/** Refresh this long before the access token expires. */
const EXPIRY_MARGIN_MS = 30_000;

type Endpoints = {
  issuer: string;
  clientId: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
};

type Tokens = Endpoints & {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
};

type PendingLogin = Endpoints & { state: string; verifier: string; returnTo: string };

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
};

/** The exact redirect URI to register with the identity provider. */
export function redirectUri(): string {
  return `${window.location.origin}/`;
}

/** Redirects to the identity provider. Comes back to the current page after login. */
export async function startLogin(oidc: Schemas["OidcConfiguration"]): Promise<void> {
  const discovery = await discover(oidc.issuer);
  const verifier = randomString();
  const state = randomString();
  const pending: PendingLogin = {
    issuer: discovery.issuer,
    clientId: oidc.clientId,
    tokenEndpoint: discovery.token_endpoint,
    endSessionEndpoint: discovery.end_session_endpoint,
    state,
    verifier,
    returnTo: window.location.href,
  };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending) ?? "");

  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: oidc.clientId,
    redirect_uri: redirectUri(),
    scope: oidc.scopes.join(" "),
    state,
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    ...(oidc.audience != undefined ? { audience: oidc.audience } : {}),
  }).toString();
  window.location.assign(url.toString());
}

/**
 * Finishes a login when the page is the identity provider's redirect back: exchanges the code
 * for tokens and restores the URL the user was on. Call before the app reads its URL.
 */
export async function completeLoginRedirect(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const state = params.get("state");
  const pending = readJson<PendingLogin>(sessionStorage, PENDING_KEY);
  if (state == undefined || pending?.state !== state) {
    return;
  }
  sessionStorage.removeItem(PENDING_KEY);
  window.history.replaceState(window.history.state, "", pending.returnTo);

  const code = params.get("code");
  if (code == undefined) {
    log.warn("Login was not completed:", params.get("error"), params.get("error_description"));
    return;
  }
  const iss = params.get("iss");
  if (iss != undefined && iss !== pending.issuer) {
    log.error("Login response came from an unexpected issuer:", iss);
    return;
  }
  const response = await requestTokens(pending, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  saveTokens(pending, response, undefined);
}

let refreshing: Promise<string | undefined> | undefined;

/** The current access token, refreshed when needed; undefined when not logged in. */
export async function getAccessToken(): Promise<string | undefined> {
  const tokens = readJson<Tokens>(localStorage, TOKENS_KEY);
  if (!tokens) {
    return undefined;
  }
  if (tokens.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return tokens.accessToken;
  }
  if (tokens.refreshToken == undefined) {
    localStorage.removeItem(TOKENS_KEY);
    return undefined;
  }
  // ponytail: one refresh per tab; tabs refreshing at the same moment can race token rotation.
  refreshing ??= refresh(tokens, tokens.refreshToken).finally(() => {
    refreshing = undefined;
  });
  return await refreshing;
}

/** Forgets the tokens and ends the identity provider session, coming back to this page. */
export function logout(): void {
  const tokens = readJson<Tokens>(localStorage, TOKENS_KEY);
  localStorage.removeItem(TOKENS_KEY);
  if (tokens?.endSessionEndpoint == undefined) {
    window.location.reload();
    return;
  }
  const url = new URL(tokens.endSessionEndpoint);
  url.search = new URLSearchParams({
    client_id: tokens.clientId,
    post_logout_redirect_uri: redirectUri(),
    ...(tokens.idToken != undefined ? { id_token_hint: tokens.idToken } : {}),
  }).toString();
  window.location.assign(url.toString());
}

async function refresh(tokens: Tokens, refreshToken: string): Promise<string | undefined> {
  try {
    const response = await requestTokens(tokens, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    return saveTokens(tokens, response, refreshToken).accessToken;
  } catch (error) {
    if (error instanceof TokenRequestError && error.status >= 400 && error.status < 500) {
      // The refresh token was revoked or expired: the user has to log in again.
      localStorage.removeItem(TOKENS_KEY);
    } else {
      log.warn("Token refresh failed, keeping tokens for the next attempt", error);
    }
    return undefined;
  }
}

class TokenRequestError extends Error {
  public constructor(public readonly status: number) {
    super(`Token request failed with ${status}`);
    this.name = "TokenRequestError";
  }
}

async function requestTokens(
  endpoints: Endpoints,
  params: Record<string, string>,
): Promise<TokenResponse> {
  const response = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: endpoints.clientId, ...params }),
  });
  if (!response.ok) {
    throw new TokenRequestError(response.status);
  }
  return (await response.json()) as TokenResponse;
}

function saveTokens(
  endpoints: Endpoints,
  response: TokenResponse,
  previousRefreshToken: string | undefined,
): Tokens {
  const previous = readJson<Tokens>(localStorage, TOKENS_KEY);
  const tokens: Tokens = {
    issuer: endpoints.issuer,
    clientId: endpoints.clientId,
    tokenEndpoint: endpoints.tokenEndpoint,
    endSessionEndpoint: endpoints.endSessionEndpoint,
    accessToken: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    refreshToken: response.refresh_token ?? previousRefreshToken,
    idToken: response.id_token ?? previous?.idToken,
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens) ?? "");
  return tokens;
}

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
};

async function discover(issuer: string): Promise<Discovery> {
  const response = await fetch(`${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`Login is unavailable: identity provider returned ${response.status}`);
  }
  const discovery = (await response.json()) as Discovery;
  if (discovery.issuer.replace(/\/+$/, "") !== issuer.replace(/\/+$/, "")) {
    throw new Error(`Identity provider reports a different issuer: ${discovery.issuer}`);
  }
  return discovery;
}

function readJson<T>(storage: Storage, key: string): T | undefined {
  try {
    const value = storage.getItem(key);
    return value == undefined ? undefined : (JSON.parse(value) as T);
  } catch {
    return undefined;
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

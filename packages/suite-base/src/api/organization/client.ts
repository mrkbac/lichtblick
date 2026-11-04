// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import createClient, { Client } from "openapi-fetch";

import { components, paths } from "./schema.gen";

export type Schemas = components["schemas"];
export type OrganizationApiClient = Client<paths>;

/** Returns the current access token, or undefined when the user is not logged in. */
export type GetAccessToken = () => Promise<string | undefined>;

export function createOrganizationApiClient(
  baseUrl: string,
  getAccessToken: GetAccessToken,
): OrganizationApiClient {
  const client = createClient<paths>({ baseUrl: baseUrl.replace(/\/+$/, "") });
  client.use({
    async onRequest({ request }) {
      const token = await getAccessToken();
      if (token) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      return request;
    },
  });
  return client;
}

export type SessionResult =
  | { status: "authenticated"; session: Schemas["CurrentSession"] }
  | { status: "unauthenticated"; oidc: Schemas["OidcConfiguration"] | null };

export async function fetchCurrentSession(client: OrganizationApiClient): Promise<SessionResult> {
  const { data, error, response } = await client.GET("/v1/me");
  if (data) {
    return { status: "authenticated", session: cleanSession(data) };
  }
  if (response.status === 401 && "oidc" in error) {
    return { status: "unauthenticated", oidc: error.oidc ?? null };
  }
  throw new OrganizationApiError(response, error);
}

export class OrganizationApiError extends Error {
  public readonly status: number;
  public readonly type: string | undefined;

  public constructor(response: Response, problem: unknown) {
    const p = (problem ?? {}) as Partial<Schemas["Problem"]>;
    super(`Organization API ${response.status}: ${cleanText(p.title ?? response.statusText, 200)}`);
    this.name = "OrganizationApiError";
    this.status = response.status;
    this.type = p.type;
  }
}

/** Formats a revision as the strong entity tag the API expects in `If-Match`. */
export function revisionETag(revision: number): string {
  return `"${revision}"`;
}

/** Only `https:` URLs (and `http:` on localhost) from the server are opened. */
export function isSafeUrl(url: string): boolean {
  const parsed = URL.parse(url);
  if (!parsed) {
    return false;
  }
  return (
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
  );
}

// Control characters, and bidi/zero-width formatting characters that can make a name display as
// something else (e.g. U+202E right-to-left override). Emoji joiners (U+200D) are kept.
const UNSAFE_TEXT =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Server-provided text made safe to show: no control or bidi characters, trimmed, length-capped. */
export function cleanText(value: string, maxLength: number): string {
  const cleaned = value.replace(UNSAFE_TEXT, "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

const NAME_LENGTH = 200;

/** The session with displayable names and only links Lichtblick is willing to open. */
function cleanSession(session: Schemas["CurrentSession"]): Schemas["CurrentSession"] {
  const { avatarUrl, ...user } = session.user;
  return {
    ...session,
    user: {
      ...user,
      displayName: cleanText(user.displayName, NAME_LENGTH),
      ...(avatarUrl != undefined && isSafeUrl(avatarUrl) ? { avatarUrl } : {}),
    },
    organizations: session.organizations.map((org) => ({
      ...org,
      displayName: cleanText(org.displayName, NAME_LENGTH),
    })),
    links: session.links
      .filter((link) => isSafeUrl(link.url))
      .map((link) => ({ ...link, label: cleanText(link.label, NAME_LENGTH) })),
  };
}

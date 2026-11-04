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
    return { status: "authenticated", session: data };
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
    super(`Organization API ${response.status}: ${p.title ?? response.statusText}`);
    this.name = "OrganizationApiError";
    this.status = response.status;
    this.type = p.type;
  }
}

/** Formats a revision as the strong entity tag the API expects in `If-Match`. */
export function revisionETag(revision: number): string {
  return `"${revision}"`;
}

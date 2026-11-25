// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as _ from "lodash-es";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import Logger from "@lichtblick/log";
import { OrganizationLayoutStorage } from "@lichtblick/suite-base/api/organization/OrganizationLayoutStorage";
import {
  OrganizationApiClient,
  Schemas,
  createOrganizationApiClient,
  fetchCurrentSession,
} from "@lichtblick/suite-base/api/organization/client";
import { getAccessToken, logout, startLogin } from "@lichtblick/suite-base/api/organization/oidc";
import { toError } from "@lichtblick/suite-base/util/toError";

const log = Logger.getLogger(__filename);

export type OrganizationState =
  /** No organization API is configured. */
  | { status: "disabled" }
  | { status: "loading" }
  /** `login` is undefined when the embedding page provides the token. */
  | { status: "unauthenticated"; login: (() => Promise<void>) | undefined }
  | {
      status: "authenticated";
      session: Schemas["CurrentSession"];
      storage: OrganizationLayoutStorage;
      logout: () => void;
    }
  /** The API could not be reached; the app works local-only. */
  | { status: "unavailable"; error: Error };

const OrganizationContext = createContext<OrganizationState>({ status: "disabled" });
OrganizationContext.displayName = "OrganizationContext";

export const OrganizationProvider = OrganizationContext.Provider;

export function useOrganization(): OrganizationState {
  return useContext(OrganizationContext);
}

const SESSION_KEY = "lichtblick.organization.session";

/**
 * The last session confirmed by the API. Starting from it keeps the app on the account's layouts
 * while the API is slow or unreachable: without it the layout manager would start on the local
 * namespace, and whatever it created there would later be imported as "(local)" copies.
 */
function readCachedSession(apiUrl: string): Schemas["CurrentSession"] | undefined {
  try {
    const cached = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as {
      apiUrl: string;
      session: Schemas["CurrentSession"];
    } | null;
    return cached?.apiUrl === apiUrl ? cached.session : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedSession(apiUrl: string, session: Schemas["CurrentSession"] | undefined): void {
  try {
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ apiUrl, session }) ?? "");
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch (error) {
    log.warn("Could not save the organization session", error);
  }
}

/** Loads the current session from the organization API at `apiUrl`, if one is configured. */
export function useOrganizationSession(apiUrl: string | undefined): OrganizationState {
  const client = useMemo(
    () => (apiUrl ? createOrganizationApiClient(apiUrl, getAccessToken) : undefined),
    [apiUrl],
  );
  const [state, setState] = useState<OrganizationState>(() => {
    if (!client || !apiUrl) {
      return { status: "disabled" };
    }
    const cached = readCachedSession(apiUrl);
    return cached ? authenticated(client, apiUrl, cached) : { status: "loading" };
  });

  useEffect(() => {
    if (!client || !apiUrl) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchCurrentSession(client);
        if (controller.signal.aborted) {
          return;
        }
        if (result.status === "authenticated") {
          writeCachedSession(apiUrl, result.session);
          // Same session as the cached one: keep the storage, so the layout manager isn't rebuilt.
          setState((previous) =>
            previous.status === "authenticated" && _.isEqual(previous.session, result.session)
              ? previous
              : authenticated(client, apiUrl, result.session),
          );
        } else {
          writeCachedSession(apiUrl, undefined);
          const { oidc } = result;
          setState({
            status: "unauthenticated",
            login: oidc
              ? async () => {
                  await startLogin(oidc);
                }
              : undefined,
          });
        }
      } catch (error) {
        log.warn("Organization API unavailable", error);
        if (controller.signal.aborted) {
          return;
        }
        // Offline or a server error says nothing about the login: stay on the cached session.
        setState((previous) =>
          previous.status === "authenticated"
            ? previous
            : { status: "unavailable", error: toError(error) },
        );
      }
    })();
    return () => {
      controller.abort();
    };
  }, [client, apiUrl]);

  return state;
}

function authenticated(
  client: OrganizationApiClient,
  apiUrl: string,
  session: Schemas["CurrentSession"],
): OrganizationState {
  return {
    status: "authenticated",
    session,
    storage: new OrganizationLayoutStorage(client, session),
    logout: () => {
      writeCachedSession(apiUrl, undefined);
      logout();
    },
  };
}

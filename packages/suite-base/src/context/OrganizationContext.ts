// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import Logger from "@lichtblick/log";
import { OrganizationLayoutStorage } from "@lichtblick/suite-base/api/organization/OrganizationLayoutStorage";
import {
  Schemas,
  createOrganizationApiClient,
  fetchCurrentSession,
} from "@lichtblick/suite-base/api/organization/client";
import { getAccessToken, logout, startLogin } from "@lichtblick/suite-base/api/organization/oidc";

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

/** Loads the current session from the organization API at `apiUrl`, if one is configured. */
export function useOrganizationSession(apiUrl: string | undefined): OrganizationState {
  const client = useMemo(
    () => (apiUrl ? createOrganizationApiClient(apiUrl, getAccessToken) : undefined),
    [apiUrl],
  );
  const [state, setState] = useState<OrganizationState>(
    client ? { status: "loading" } : { status: "disabled" },
  );

  useEffect(() => {
    if (!client) {
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
          setState({
            status: "authenticated",
            session: result.session,
            storage: new OrganizationLayoutStorage(client, result.session),
            logout,
          });
        } else {
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
        log.error("Organization API unavailable", error);
        if (!controller.signal.aborted) {
          setState({ status: "unavailable", error: error as Error });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [client]);

  return state;
}

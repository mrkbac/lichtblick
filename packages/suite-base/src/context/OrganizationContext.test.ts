/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook, waitFor } from "@testing-library/react";

import { Schemas, fetchCurrentSession } from "@lichtblick/suite-base/api/organization/client";

import { useOrganizationSession } from "./OrganizationContext";

vi.mock("@lichtblick/suite-base/api/organization/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lichtblick/suite-base/api/organization/client")>()),
  fetchCurrentSession: vi.fn(),
}));

const API_URL = "https://api.example.com";
const session: Schemas["CurrentSession"] = {
  user: { id: "user-1", displayName: "Me" },
  links: [],
  organizations: [],
};
const fetchSession = vi.mocked(fetchCurrentSession);

describe("useOrganizationSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts from the cached session and keeps it while the API is unreachable", async () => {
    fetchSession.mockResolvedValueOnce({ status: "authenticated", session });
    const first = renderHook(() => useOrganizationSession(API_URL));
    expect(first.result.current.status).toBe("loading");
    await waitFor(() => {
      expect(first.result.current.status).toBe("authenticated");
    });
    first.unmount();

    fetchSession.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useOrganizationSession(API_URL));
    expect(result.current.status).toBe("authenticated");
    await waitFor(() => {
      expect(fetchSession).toHaveBeenCalledTimes(2);
    });
    expect(result.current).toMatchObject({ status: "authenticated", session });
    expect(console.warn).toHaveBeenCalled();
    vi.mocked(console.warn).mockClear();
  });

  it("keeps the storage when the API confirms the cached session", async () => {
    fetchSession.mockResolvedValue({ status: "authenticated", session });
    const first = renderHook(() => useOrganizationSession(API_URL));
    await waitFor(() => {
      expect(first.result.current.status).toBe("authenticated");
    });
    first.unmount();

    const { result } = renderHook(() => useOrganizationSession(API_URL));
    const initial = result.current;
    await waitFor(() => {
      expect(fetchSession).toHaveBeenCalledTimes(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current).toBe(initial);
  });

  it("drops the cached session when the API says it is logged out", async () => {
    fetchSession.mockResolvedValueOnce({ status: "authenticated", session });
    const first = renderHook(() => useOrganizationSession(API_URL));
    await waitFor(() => {
      expect(first.result.current.status).toBe("authenticated");
    });
    first.unmount();

    fetchSession.mockResolvedValueOnce({ status: "unauthenticated", oidc: null });
    const second = renderHook(() => useOrganizationSession(API_URL));
    await waitFor(() => {
      expect(second.result.current.status).toBe("unauthenticated");
    });
    second.unmount();

    fetchSession.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => useOrganizationSession(API_URL));
    expect(result.current.status).toBe("loading");
  });
});

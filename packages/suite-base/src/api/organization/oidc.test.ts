/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

const TOKENS_KEY = "lichtblick.organization.tokens";

// Each module instance stands in for one browser tab; they share localStorage and the lock manager.
async function openTab(): Promise<typeof import("./oidc")> {
  vi.resetModules();
  return await import("./oidc");
}

describe("getAccessToken", () => {
  let tail: Promise<unknown>;

  beforeEach(() => {
    tail = Promise.resolve();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: async (_name: string, callback: () => Promise<unknown>) => {
          const result = tail.then(callback);
          tail = result.catch(() => undefined);
          return await result;
        },
      },
    });
    localStorage.setItem(
      TOKENS_KEY,
      JSON.stringify({
        issuer: "https://idp.example",
        clientId: "app",
        tokenEndpoint: "https://idp.example/token",
        accessToken: "old",
        expiresAt: Date.now() - 1000,
        refreshToken: "refresh-1",
      }) ?? "",
    );
  });

  afterEach(() => {
    delete (navigator as { locks?: unknown }).locks;
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("refreshes a rotating refresh token once when two tabs need it at the same time", async () => {
    const used: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const token = new URLSearchParams(init.body as string).get("refresh_token")!;
        used.push(token);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(
          JSON.stringify({ access_token: "new", expires_in: 3600, refresh_token: "refresh-2" }),
        );
      }),
    );
    const tabA = await openTab();
    const tabB = await openTab();

    await expect(Promise.all([tabA.getAccessToken(), tabB.getAccessToken()])).resolves.toEqual([
      "new",
      "new",
    ]);
    expect(used).toEqual(["refresh-1"]);
  });
});

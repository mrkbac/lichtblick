// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import BrowserHttpReader from "./BrowserHttpReader";

describe("BrowserHttpReader credentials", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it.each([["include" as const], [undefined]])(
    "passes credentials=%s to the open and range requests",
    async (credentials) => {
      const fetchMock = vi.fn().mockImplementation(
        async () =>
          new Response("abc", {
            headers: { "accept-ranges": "bytes", "content-length": "3" },
          }),
      );
      globalThis.fetch = fetchMock;
      const reader = new BrowserHttpReader("https://example.com/a.mcap", { credentials });

      await expect(reader.open()).resolves.toEqual({ size: 3, identifier: undefined });
      const stream = reader.fetch(0, 3);
      await new Promise<void>((resolve) => {
        stream.on("end", resolve);
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      for (const [, init] of fetchMock.mock.calls) {
        expect((init as RequestInit).credentials).toBe(credentials);
      }
    },
  );
});

describe("BrowserHttpReader open errors", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    vi.stubGlobal("location", new URL("https://app.example/"));
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
  });

  // fetch() rejects with this for both CORS and network failures
  const blocked = async () => {
    throw new TypeError("Failed to fetch");
  };
  const opaque = async () => new Response(undefined, { status: 200 });

  it.each([
    [undefined, /allows https:\/\/app\.example \(or \*\)/],
    [
      "include" as const,
      /Allow-Credentials: true and Access-Control-Allow-Origin: https:\/\/app\.example \(a wildcard/,
    ],
  ])(
    "reports CORS when a no-cors request reaches the server (credentials=%s)",
    async (credentials, message) => {
      const fetchMock = vi.fn().mockImplementationOnce(blocked).mockImplementationOnce(opaque);
      globalThis.fetch = fetchMock;
      const reader = new BrowserHttpReader("https://example.com/a.mcap", { credentials });

      await expect(reader.open()).rejects.toThrow(message);
      expect(fetchMock.mock.calls[1]![1]).toMatchObject({ mode: "no-cors", credentials });
    },
  );

  it("only mentions credentials headers for credentialed requests", async () => {
    globalThis.fetch = vi.fn().mockImplementationOnce(blocked).mockImplementationOnce(opaque);
    const reader = new BrowserHttpReader("https://example.com/a.mcap");

    await expect(reader.open()).rejects.toThrow(/^(?!.*Allow-Credentials)/s);
  });

  it("reports an inconclusive error when the no-cors request fails too", async () => {
    globalThis.fetch = vi.fn().mockImplementation(blocked);
    const reader = new BrowserHttpReader("https://example.com/a.mcap", { credentials: "include" });

    await expect(reader.open()).rejects.toThrow(/^Couldn't read from https:\/\/example\.com\./);
  });

  it("passes other errors through without probing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));
    globalThis.fetch = fetchMock;
    const reader = new BrowserHttpReader("https://example.com/a.mcap");

    await expect(reader.open()).rejects.toThrow(/^Fetching remote file failed\./);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

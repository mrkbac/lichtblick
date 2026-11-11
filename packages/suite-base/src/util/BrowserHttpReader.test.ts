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

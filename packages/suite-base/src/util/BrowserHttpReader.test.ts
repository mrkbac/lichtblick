// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import BrowserHttpReader from "./BrowserHttpReader";

const FILE_URL = "https://example.com/example.mcap";
const EDGE = 64 * 1024;

function file(size: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => i % 251);
}

function rangeOf(init: RequestInit | undefined): string | undefined {
  return new Headers(init?.headers).get("range") ?? undefined;
}

/** A server that answers byte ranges (including suffix ranges) of `data` */
function rangeServer(
  data: Uint8Array<ArrayBuffer>,
  options: {
    headers?: (range: string) => Record<string, string>;
    tail?: () => Response | Promise<Response>;
    fullEtag?: string;
  } = {},
) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const range = rangeOf(init);
    const match = range != undefined ? /^bytes=(\d*)-(\d*)$/.exec(range) : undefined;
    if (!match) {
      return new Response(data.slice(), {
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(data.length),
          etag: options.fullEtag ?? '"v1"',
        },
      });
    }
    if (match[1] === "" && options.tail) {
      return await options.tail();
    }
    const start = match[1] === "" ? Math.max(0, data.length - Number(match[2])) : Number(match[1]);
    const end =
      match[1] === "" || match[2] === ""
        ? data.length
        : Math.min(Number(match[2]) + 1, data.length);
    return new Response(data.slice(start, end), {
      status: 206,
      headers: {
        "content-range": `bytes ${start}-${end - 1}/${data.length}`,
        etag: '"v1"',
        ...options.headers?.(range!),
      },
    });
  });
}

describe("BrowserHttpReader open", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("requests both ends in parallel and returns them with the size", async () => {
    const data = file(EDGE * 3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = rangeServer(data);
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      await gate;
      return await server(url, init);
    });
    globalThis.fetch = fetchMock;

    const opened = new BrowserHttpReader(FILE_URL).open();
    // Both requests go out before either answers: one round trip
    await Promise.resolve();
    expect(fetchMock.mock.calls.map(([, init]) => rangeOf(init))).toEqual([
      `bytes=0-${EDGE - 1}`,
      `bytes=-${EDGE}`,
    ]);
    release();

    await expect(opened).resolves.toEqual({
      size: data.length,
      identifier: '"v1"',
      initialData: [
        { offset: 0, data: data.slice(0, EDGE) },
        { offset: data.length - EDGE, data: data.slice(-EDGE) },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("handles files smaller than one edge", async () => {
    const data = file(1000);
    globalThis.fetch = rangeServer(data);

    await expect(new BrowserHttpReader(FILE_URL).open()).resolves.toMatchObject({
      size: 1000,
      initialData: [
        { offset: 0, data },
        { offset: 0, data },
      ],
    });
  });

  it("doesn't download the body when the server ignores the range", async () => {
    const data = file(EDGE * 3);
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return new Response(data.slice(), {
        headers: { "accept-ranges": "bytes", "content-length": String(data.length) },
      });
    });

    await expect(new BrowserHttpReader(FILE_URL).open()).resolves.toEqual({
      size: data.length,
      identifier: undefined,
    });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("rejects servers without range support", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("abc", { headers: { "content-length": "3" } }),
    );

    await expect(new BrowserHttpReader(FILE_URL).open()).rejects.toThrow(
      /Support for HTTP Range requests was not detected/,
    );
  });

  it("reports the status code of failed requests", async () => {
    globalThis.fetch = vi.fn(async () => new Response("missing", { status: 404 }));

    await expect(new BrowserHttpReader(FILE_URL).open()).rejects.toThrow(/Status code: 404/);
  });

  it("asks for the size without a range when Content-Range is not exposed", async () => {
    const data = file(EDGE * 3);
    const fetchMock = rangeServer(data, { headers: () => ({ "content-range": "" }) });
    globalThis.fetch = fetchMock;

    await expect(new BrowserHttpReader(FILE_URL).open()).resolves.toEqual({
      size: data.length,
      identifier: '"v1"',
      initialData: [{ offset: 0, data: data.slice(0, EDGE) }],
    });
    expect(rangeOf(fetchMock.mock.calls[2]![1])).toBeUndefined();
  });

  it("drops the head when the size request sees another file version", async () => {
    const data = file(EDGE * 3);
    globalThis.fetch = rangeServer(data, {
      headers: () => ({ "content-range": "" }),
      fullEtag: '"v2"',
    });

    await expect(new BrowserHttpReader(FILE_URL).open()).resolves.toEqual({
      size: data.length,
      identifier: '"v2"',
    });
  });

  it.each([
    ["exposed", `bytes 0-${EDGE - 1}/${EDGE * 3}`],
    ["hidden", ""],
  ])(
    "opens without the head when its body fails (Content-Range %s)",
    async (_, contentRangeHeader) => {
      const data = file(EDGE * 3);
      const server = rangeServer(data, {
        headers: () => ({ "content-range": contentRangeHeader }),
      });
      globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
        rangeOf(init) === `bytes=0-${EDGE - 1}`
          ? new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("connection reset"));
                },
              }),
              { status: 206, headers: { "content-range": contentRangeHeader, etag: '"v1"' } },
            )
          : await server(url, init),
      );

      const opened = await new BrowserHttpReader(FILE_URL).open();
      expect(opened.size).toBe(data.length);
      expect(opened.initialData?.some(({ offset }) => offset === 0) ?? false).toBe(false);
    },
  );

  it("doesn't wait for a stalled tail", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const data = file(EDGE * 3);
      globalThis.fetch = rangeServer(data, { tail: async () => await new Promise(() => {}) });

      const opened = new BrowserHttpReader(FILE_URL).open();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(opened).resolves.toEqual({
        size: data.length,
        identifier: '"v1"',
        initialData: [{ offset: 0, data: data.slice(0, EDGE) }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [
      "fails",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
    ["is ignored", () => new Response(file(EDGE * 3), { status: 200 })],
    [
      "returns another interval",
      () =>
        new Response(file(EDGE), {
          status: 206,
          headers: { "content-range": `bytes 0-${EDGE - 1}/${EDGE * 3}`, etag: '"v1"' },
        }),
    ],
    [
      "is from another version",
      () =>
        new Response(file(EDGE), {
          status: 206,
          headers: { "content-range": `bytes 0-${EDGE - 1}/${EDGE * 3}`, etag: '"v2"' },
        }),
    ],
  ])("opens with the head only when the tail request %s", async (_, tail) => {
    const data = file(EDGE * 3);
    globalThis.fetch = rangeServer(data, { tail });

    await expect(new BrowserHttpReader(FILE_URL).open()).resolves.toEqual({
      size: data.length,
      identifier: '"v1"',
      initialData: [{ offset: 0, data: data.slice(0, EDGE) }],
    });
  });
});

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

      // Head and tail of the file, then the range read
      expect(fetchMock).toHaveBeenCalledTimes(3);
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
  // Only the no-cors probe gets through
  const corsBlocked = async (_url: RequestInfo | URL, init?: RequestInit) =>
    init?.mode === "no-cors" ? new Response(undefined, { status: 200 }) : await blocked();

  it.each([
    [undefined, /allows https:\/\/app\.example \(or \*\)/],
    [
      "include" as const,
      /Allow-Credentials: true and Access-Control-Allow-Origin: https:\/\/app\.example \(a wildcard/,
    ],
  ])(
    "reports CORS when a no-cors request reaches the server (credentials=%s)",
    async (credentials, message) => {
      const fetchMock = vi.fn(corsBlocked);
      globalThis.fetch = fetchMock;
      const reader = new BrowserHttpReader("https://example.com/a.mcap", { credentials });

      await expect(reader.open()).rejects.toThrow(message);
      expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ mode: "no-cors", credentials });
    },
  );

  it("only mentions credentials headers for credentialed requests", async () => {
    globalThis.fetch = vi.fn(corsBlocked);
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
    // Head and tail, no probe
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

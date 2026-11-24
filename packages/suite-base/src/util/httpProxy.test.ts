// SPDX-License-Identifier: MPL-2.0

import {
  needsHttpProxy,
  proxiedFetch,
  resetHttpProxyForTests,
  setHttpProxyChannel,
} from "./httpProxy";

const ORIGIN = "https://digitalis.marko.im";

/** Plays the extension's content script on the far end of a worker channel port. */
function fakeExtension(
  respond: (request: { url: string; headers: [string, string][] }, port: MessagePort) => void,
): MessageChannel {
  const channel = new MessageChannel();
  channel.port2.onmessage = ({
    data,
    ports,
  }: MessageEvent<{ url: string; headers: [string, string][] }>) => {
    const port = ports[0]!;
    port.postMessage({ ev: "attached" });
    respond(data, port);
  };
  setHttpProxyChannel(channel.port1);
  return channel;
}

describe("needsHttpProxy", () => {
  beforeEach(() => {
    setHttpProxyChannel(new MessageChannel().port1);
  });
  afterEach(() => {
    resetHttpProxyForTests();
  });

  it.each([
    ["http://robot.example/a.mcap", ORIGIN, true],
    ["http://10.0.0.5:8080/catalog.json", ORIGIN, true],
    ["https://robot.example/a.mcap", ORIGIN, false],
    ["http://localhost:8080/a.mcap", ORIGIN, false],
    ["http://127.0.0.1:8080/a.mcap", ORIGIN, false],
    ["http://robot.example/a.mcap", "http://digitalis.marko.im", false],
    ["http://robot.example/a.mcap", "https://preview.example", false],
    ["/relative.mcap", ORIGIN, false],
  ])("%s from %s → %s", (url, origin, expected) => {
    expect(needsHttpProxy(url, origin)).toBe(expected);
  });

  it("is false in a worker without a channel", () => {
    resetHttpProxyForTests();
    expect(needsHttpProxy("http://robot.example/a.mcap", ORIGIN)).toBe(false);
  });
});

describe("proxiedFetch", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { origin: ORIGIN, href: `${ORIGIN}/` });
  });
  afterEach(() => {
    resetHttpProxyForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("streams a ranged response through the extension", async () => {
    const channel = fakeExtension((request, port) => {
      expect(request.url).toBe("http://robot.example/a.mcap");
      expect(request.headers).toEqual([["range", "bytes=0-3"]]);
      port.postMessage({
        ev: "head",
        status: 206,
        statusText: "Partial Content",
        headers: [["content-range", "bytes 0-3/10"]],
      });
      const first = new Uint8Array([1, 2]).buffer;
      const second = new Uint8Array([3, 4]).buffer;
      port.postMessage({ ev: "chunk", data: first }, [first]);
      port.postMessage({ ev: "chunk", data: second }, [second]);
      port.postMessage({ ev: "end" });
    });

    const response = await proxiedFetch("http://robot.example/a.mcap", {
      headers: { range: "bytes=0-3" },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/10");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    channel.port2.close();
  });

  it("rejects with a TypeError when the extension's fetch fails", async () => {
    const channel = fakeExtension((_request, port) => {
      port.postMessage({ ev: "error", message: "Failed to fetch" });
    });
    await expect(proxiedFetch("http://robot.example/a.mcap")).rejects.toThrow(TypeError);
    channel.port2.close();
  });

  it("falls back to a direct fetch when no extension answers", async () => {
    vi.useFakeTimers();
    setHttpProxyChannel(new MessageChannel().port1); // nobody listens on the other end
    const direct = vi.fn(async () => new Response("direct"));
    vi.stubGlobal("fetch", direct);

    const response = proxiedFetch("http://robot.example/a.mcap");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await (await response).text()).toBe("direct");
    // Later requests skip the proxy
    expect(needsHttpProxy("http://robot.example/a.mcap")).toBe(false);
  });
});

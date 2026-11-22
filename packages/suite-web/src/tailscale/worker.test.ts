// SPDX-License-Identifier: MPL-2.0

import { gzipSync } from "node:zlib";

import { attachStream } from "./stream";

vi.mock("@ai-ecoverse/wasm-tailscale/wasm_exec.js", () => ({}));
vi.mock("./stream", () => ({ attachStream: vi.fn() }));
vi.mock("./profile", () => ({
  openProfile: async () => ({ flush: async () => {}, close: () => {}, storage: {} }),
}));

it("releases only the closing tab's live streams and retires the node after the last tab", async () => {
  const scope = {
    location: new URL("https://example.org/worker.js"),
    onconnect: vi.fn(),
    close: vi.fn(),
  };
  const run = vi.fn();
  vi.stubGlobal("self", scope);
  vi.stubGlobal("TAILSCALE_WASM_ASSET", "client.gz");
  vi.stubGlobal(
    "Go",
    class {
      public run = async () => {};
    },
  );
  vi.stubGlobal("newIPN", () => ({ run }));
  // A valid empty WebAssembly module exercises decompression and instantiation.
  vi.stubGlobal(
    "fetch",
    async () => new Response(gzipSync(Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0))),
  );
  const first = new MessageChannel();
  const second = new MessageChannel();
  const streamA = new MessageChannel();
  const streamB = new MessageChannel();
  try {
    await import("./worker");
    for (const channel of [first, second]) {
      scope.onconnect({ ports: [channel.port1] });
      channel.port2.postMessage("start");
    }
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });
    first.port2.postMessage({ port: streamA.port2 }, [streamA.port2]);
    second.port2.postMessage({ port: streamB.port2 }, [streamB.port2]);
    await vi.waitFor(() => {
      expect(attachStream).toHaveBeenCalledTimes(2);
    });
    const [a, b] = vi.mocked(attachStream).mock.calls.map((call) => call[2].signal);
    first.port2.postMessage("release");
    await vi.waitFor(() => {
      expect(a?.aborted).toBe(true);
    });
    expect(b?.aborted).toBe(false);
    expect(scope.close).not.toHaveBeenCalled();
    second.port2.close();
    await vi.waitFor(() => {
      expect(scope.close).toHaveBeenCalled();
    });
    expect(b?.aborted).toBe(true);
  } finally {
    for (const channel of [first, second, streamA, streamB]) {
      channel.port1.close();
      channel.port2.close();
    }
    for (const [, port] of vi.mocked(attachStream).mock.calls) {
      port.close();
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

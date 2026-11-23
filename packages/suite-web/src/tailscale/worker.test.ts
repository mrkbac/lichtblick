// SPDX-License-Identifier: MPL-2.0

import { gzipSync } from "node:zlib";

import { openProfile } from "./profile";
import { attachStream } from "./stream";
import type { SessionStatus } from "./worker";

vi.mock("@ai-ecoverse/wasm-tailscale/wasm_exec.js", () => ({}));
vi.mock("./stream", () => ({ attachStream: vi.fn() }));
vi.mock("./profile", () => ({
  openProfile: vi.fn(async () => ({ flush: async () => {}, close: () => {}, storage: {} })),
}));

afterEach(() => {
  vi.resetModules();
});

it("retries startup after the browser profile could not be opened", async () => {
  vi.stubGlobal("self", { location: new URL("https://example.org/worker.js"), close: vi.fn() });
  // Stop startup right after the profile opens; only the retry path matters here.
  vi.stubGlobal("fetch", async () => new Response(undefined, { status: 404 }));
  vi.mocked(openProfile).mockRejectedValueOnce(new Error("blocked"));
  const tab = new MessageChannel();
  try {
    await import("./worker");
    const updates: SessionStatus[] = [];
    tab.port2.onmessage = (event: MessageEvent<SessionStatus>) => {
      updates.push(event.data);
    };
    (self as unknown as SharedWorkerGlobalScope).onconnect!({
      ports: [tab.port1],
    } as unknown as MessageEvent);
    tab.port2.postMessage("start");
    await vi.waitFor(() => {
      expect(updates.at(-1)?.error).toBe("tailscaleStorageError");
    });
    tab.port2.postMessage("start");
    await vi.waitFor(() => {
      expect(openProfile).toHaveBeenCalledTimes(2);
    });
    expect(updates.some((update, i) => i > 0 && update.error == undefined)).toBe(true);
  } finally {
    tab.port1.close();
    tab.port2.close();
    vi.unstubAllGlobals();
  }
});

it("releases only the closing tab's live streams and retires the node after the last tab", async () => {
  const scope = {
    location: new URL("https://example.org/worker.js"),
    onconnect: vi.fn(),
    close: vi.fn(),
  };
  const run =
    vi.fn<
      (callbacks: { notifyNetMap(json: string): void; notifyState(state: string): void }) => void
    >();
  const status = vi.fn(() =>
    JSON.stringify({
      peers: [
        { name: "device", dnsName: "device.example.", addresses: [], online: false },
        { name: "Example workshop", addresses: ["192.0.2.1"], online: true },
        { name: "No address" },
      ],
    }),
  );
  vi.stubGlobal("self", scope);
  vi.stubGlobal("TAILSCALE_WASM_ASSET", "client.gz");
  vi.stubGlobal(
    "Go",
    class {
      public run = async () => {};
    },
  );
  vi.stubGlobal("newIPN", () => ({ run, status }));
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
    const updates: SessionStatus[] = [];
    first.port2.onmessage = (event: MessageEvent<SessionStatus>) => {
      updates.push(event.data);
    };
    const callbacks = run.mock.calls[0]![0];
    callbacks.notifyNetMap(
      JSON.stringify({
        peers: [
          { name: "device.example.", addresses: [], online: true },
          { name: "", addresses: ["example"], online: false },
          { name: "unknown.example.", addresses: [] },
        ],
      })!,
    );
    await vi.waitFor(() => {
      expect(updates.at(-1)?.peers).toEqual([
        { name: "device.example", online: true },
        { name: "example", online: false },
        { name: "unknown.example", online: undefined },
      ]);
    });
    callbacks.notifyState("Running");
    await vi.waitFor(() => {
      expect(updates.at(-1)?.state).toBe("Running");
    });
    first.port2.postMessage("refreshPeers");
    await vi.waitFor(() => {
      expect(updates.at(-1)?.peers).toEqual([
        { name: "device.example", online: false },
        { name: "192.0.2.1", label: "Example workshop", online: true },
      ]);
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

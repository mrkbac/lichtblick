// SPDX-License-Identifier: MPL-2.0

import WorkerMessageSocket from "@lichtblick/suite-base/players/WorkerMessageSocket";

import { attachStream } from "./stream";

describe("Tailscale message transport", () => {
  it("passes the negotiated protocol, text and the exact binary view to the player in order", async () => {
    const { port1, port2 } = new MessageChannel();
    const frames = ["advertise", new Uint8Array([0, 1, 2, 3]).subarray(1, 3)];
    const protocol = "foxglove.websocket.v1";
    const websocket = vi.fn(async () => ({
      protocol,
      buffered: 0,
      send: vi.fn(),
      close: vi.fn(),
      messages: (async function* () {
        yield* frames;
      })(),
      closed: Promise.resolve({ code: 1000, reason: "Complete" }),
    }));
    const abort = new AbortController();
    attachStream({ websocket }, port2, abort, () => {});
    const adapter = new WorkerMessageSocket(port1, "ws://example:8765", [protocol]);
    const seen: unknown[] = [];
    adapter.onmessage = (event) => seen.push((event as MessageEvent).data);
    const closeEvent = await new Promise<unknown>((resolve) => {
      adapter.onclose = resolve;
    });
    expect(closeEvent).toEqual({ code: 1000, reason: "Complete" });
    expect(adapter.protocol).toBe(protocol);
    expect(websocket).toHaveBeenCalledWith({
      url: "ws://example:8765",
      protocols: [protocol],
      signal: abort.signal,
    });
    expect(seen[0]).toBe("advertise");
    expect(Array.from(new Uint8Array(seen[1] as ArrayBuffer))).toEqual([1, 2]);
  });

  it("sends text and the visible bytes of typed views through the tunnel", async () => {
    const { port1, port2 } = new MessageChannel();
    const sent = Promise.withResolvers<void>();
    const send = vi.fn((data: unknown) => {
      if (typeof data !== "string") {
        sent.resolve();
      }
      return undefined;
    });
    const abort = new AbortController();
    const websocket = vi.fn(async () => ({
      protocol: "foxglove.websocket.v1",
      buffered: 0,
      close: vi.fn(),
      send,
      messages: (async function* () {
        await sent.promise;
        yield "done";
      })(),
      closed: Promise.resolve({ code: 1000, reason: "" }),
    }));
    attachStream({ websocket }, port2, abort, () => {});
    const adapter = new WorkerMessageSocket(port1, "ws://example:8765");
    adapter.onopen = () => {
      adapter.send("subscribe");
      adapter.send(new DataView(new Uint8Array([0, 42, 1]).buffer, 1, 1));
    };
    await new Promise<unknown>((resolve) => {
      adapter.onclose = resolve;
    });
    expect(send.mock.calls).toEqual([["subscribe"], [new Uint8Array([42])]]);
  });

  it("waits for the tab before reading another large frame and can abort while paused", async () => {
    const { port1, port2 } = new MessageChannel();
    const read = vi.fn();
    const abort = new AbortController();
    const websocket = vi.fn(async () => ({
      protocol: "foxglove.websocket.v1",
      buffered: 0,
      close: vi.fn(),
      send: vi.fn(),
      messages: (async function* () {
        for (let i = 0; i < 3; i++) {
          read();
          yield new Uint8Array(1024 * 1024);
        }
      })(),
      closed: Promise.resolve({ code: 1000, reason: "" }),
    }));
    const done = Promise.withResolvers<void>();
    attachStream({ websocket }, port2, abort, done.resolve);
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    port1.onmessage = ({ data }: MessageEvent<{ type: string; acknowledge?: boolean }>) => {
      if (data.type === "message" && data.acknowledge === true) {
        if (read.mock.calls.length === 1) {
          first.resolve();
        } else {
          second.resolve();
        }
      }
    };
    try {
      port1.postMessage({ type: "open", data: { wsUrl: "ws://example:8765" } });
      await first.promise;
      expect(read).toHaveBeenCalledTimes(1);
      port1.postMessage({ type: "drained", data: undefined });
      await second.promise;
      abort.abort();
      await done.promise;
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      port1.close();
    }
  });

  it("aborts a handshake when the player closes before open", async () => {
    const { port1, port2 } = new MessageChannel();
    const abort = new AbortController();
    const websocket = vi.fn(
      async () =>
        await new Promise<never>((_, reject) => {
          abort.signal.addEventListener("abort", () => {
            reject(new Error("Cancelled"));
          });
        }),
    );
    attachStream({ websocket }, port2, abort, () => {});
    const adapter = new WorkerMessageSocket(port1, "ws://example:8765", []);
    const closed = new Promise<void>((done) => {
      adapter.onclose = () => {
        done();
      };
    });
    adapter.close();
    await closed;
    expect(abort.signal.aborted).toBe(true);
  });
});

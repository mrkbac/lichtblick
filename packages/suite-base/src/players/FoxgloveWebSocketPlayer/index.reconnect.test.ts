// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PlayerState } from "@lichtblick/suite-base/players/types";

import FoxgloveWebSocketPlayer from "./index";

class MockWebSocket {
  public static lastInstance: MockWebSocket | undefined;
  public binaryType = "";
  public protocol = "foxglove.websocket.v1";
  public onerror?: (event: unknown) => void;
  public onopen?: (event: unknown) => void;
  public onclose?: (event: unknown) => void;
  public onmessage?: (event: unknown) => void;
  public close = vi.fn();
  public send = vi.fn();

  public constructor() {
    MockWebSocket.lastInstance = this;
  }

  public receive(data: unknown): void {
    this.onmessage?.({ data });
  }

  public sentOps(): { op: string; channels?: { topic: string }[] }[] {
    return this.send.mock.calls
      .map(([data]) => data)
      .filter((data): data is string => typeof data === "string")
      .map((data) => JSON.parse(data) as { op: string });
  }
}

const CHANNEL = {
  id: 1,
  topic: "/foo",
  encoding: "json",
  schemaName: "S",
  schema: JSON.stringify({ type: "object" }),
};
const SERVICE = {
  id: 7,
  name: "/svc",
  type: "svc_type",
  request: {
    encoding: "json",
    schemaName: "req",
    schemaEncoding: "jsonschema",
    schema: JSON.stringify({ type: "object" }),
  },
  response: {
    encoding: "json",
    schemaName: "res",
    schemaEncoding: "jsonschema",
    schema: JSON.stringify({ type: "object" }),
  },
};

/** FetchAssetResponse (op 4) with status 1 (error) */
function fetchAssetError(requestId: number, error: string) {
  const text = new TextEncoder().encode(error);
  const buffer = new ArrayBuffer(10 + text.length);
  const view = new DataView(buffer);
  view.setUint8(0, 4);
  view.setUint32(1, requestId, true);
  view.setUint8(5, 1);
  view.setUint32(6, text.length, true);
  new Uint8Array(buffer).set(text, 10);
  return buffer;
}

describe("FoxgloveWebSocketPlayer reconnect", () => {
  let player: FoxgloveWebSocketPlayer;
  let ws: MockWebSocket;
  let lastState: PlayerState | undefined;

  function connect() {
    ws = MockWebSocket.lastInstance!;
    ws.onopen?.({});
    ws.receive(
      JSON.stringify({
        op: "serverInfo",
        name: "test",
        sessionId: "session",
        capabilities: ["clientPublish", "services", "assets"],
        supportedEncodings: ["json"],
      }),
    );
    ws.receive(JSON.stringify({ op: "advertise", channels: [CHANNEL] }));
    ws.receive(JSON.stringify({ op: "advertiseServices", services: [SERVICE] }));
  }

  function close() {
    ws.onclose?.({ code: 1006 });
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
  }

  async function drop() {
    close();
    await vi.advanceTimersByTimeAsync(3_000); // reconnect delay
  }

  beforeEach(() => {
    vi.useFakeTimers();
    (global as { WebSocket?: unknown }).WebSocket = MockWebSocket;
    player = new FoxgloveWebSocketPlayer({
      url: "ws://localhost:8765",
      sourceId: "foxglove-websocket",
    });
    player.setListener(async (state) => {
      lastState = state;
    });
    connect();
  });

  afterEach(() => {
    player.close();
    vi.useRealTimers();
    delete (global as { WebSocket?: unknown }).WebSocket;
  });

  it("re-advertises publishers on the new connection", async () => {
    player.setPublishers([{ topic: "/foo", schemaName: "S" }]);
    await drop();
    connect();

    expect(ws.sentOps()).toContainEqual(
      expect.objectContaining({
        op: "advertise",
        channels: [expect.objectContaining({ topic: "/foo" })],
      }),
    );
    expect(() => {
      player.publish({ topic: "/foo", msg: {} });
    }).not.toThrow();
  });

  it("rejects pending service calls when the connection closes", async () => {
    const call = player.callService("/svc", {});
    await expect(Promise.all([call, drop()])).rejects.toThrow("Connection closed");
  });

  it("doesn't resubscribe a topic dropped during the outage", async () => {
    player.setSubscriptions([{ topic: "/foo" }]);
    expect(ws.sentOps().map(({ op }) => op)).toContain("subscribe");
    close();
    player.setSubscriptions([]);
    await vi.advanceTimersByTimeAsync(3_000);
    connect();
    expect(ws.sentOps().map(({ op }) => op)).not.toContain("subscribe");
  });

  it("doesn't unsubscribe stale ids while the new connection is opening", async () => {
    player.setSubscriptions([{ topic: "/foo" }]);
    await drop();
    player.setSubscriptions([]);
    expect(MockWebSocket.lastInstance!.sentOps()).toEqual([]);
  });

  it("doesn't duplicate capabilities across reconnects", async () => {
    await drop();
    connect();
    await vi.advanceTimersByTimeAsync(100);
    const capabilities = lastState?.capabilities ?? [];
    expect(capabilities.length).toBeGreaterThan(0);
    expect(new Set(capabilities).size).toBe(capabilities.length);
  });

  it("retries an asset whose fetch failed", async () => {
    const first = player.fetchAsset("package://foo/mesh.stl");
    ws.receive(fetchAssetError(1, "not found"));
    await expect(first).rejects.toThrow("not found");

    ws.send.mockClear();
    void player.fetchAsset("package://foo/mesh.stl").catch(() => {});
    expect(ws.send).toHaveBeenCalled();
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PlayerState } from "@lichtblick/suite-base/players/types";

import FoxgloveWebSocketPlayer, {
  LINK_PROBE_TIMEOUT_MS,
  LINK_SILENCE_MS,
  STABLE_CONNECTION_MS,
} from "./index";

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

/** MessageData (op 1) carrying a JSON payload */
function messageData(subscriptionId: number, timeNs: bigint, payload = "{}") {
  const text = new TextEncoder().encode(payload);
  const buffer = new ArrayBuffer(13 + text.length);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint32(1, subscriptionId, true);
  view.setBigUint64(5, timeNs, true);
  new Uint8Array(buffer).set(text, 13);
  return buffer;
}

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

  function connect(
    sessionId = "session",
    capabilities = ["clientPublish", "services", "assets"],
    supportedEncodings = ["json"],
  ) {
    ws = MockWebSocket.lastInstance!;
    ws.onopen?.({});
    ws.receive(
      JSON.stringify({
        op: "serverInfo",
        name: "test",
        sessionId,
        capabilities,
        supportedEncodings,
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
    // The reconnect delay grows with each drop of a connection that didn't stay up
    for (let i = 0; i < 60 && MockWebSocket.lastInstance === ws; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(MockWebSocket.lastInstance).not.toBe(ws);
  }

  /** Subscribes to /foo and receives `count` messages on it */
  async function receiveFoo(count: number) {
    player.setSubscriptions([{ topic: "/foo" }]);
    await Promise.resolve(); // subscriptions go out once per task
    const subscribe = ws.sentOps().findLast(({ op }) => op === "subscribe") as
      | { subscriptions: { id: number }[] }
      | undefined;
    const subId = subscribe?.subscriptions[0]?.id ?? 0;
    for (let i = 0; i < count; i++) {
      ws.receive(messageData(subId, BigInt(i)));
    }
    await vi.advanceTimersByTimeAsync(100);
  }

  const stats = () => lastState?.activeData?.topicStats.get("/foo")?.numMessages;
  const historyMessages = () => lastState?.activeData?.liveStats?.historyMessages;

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

  it("doesn't advertise on a socket that is still connecting", async () => {
    await drop();
    const next = MockWebSocket.lastInstance!;
    player.setPublishers([{ topic: "/foo", schemaName: "S" }]);
    expect(next.sentOps()).toEqual([]);

    connect();
    expect(next.sentOps().filter(({ op }) => op === "advertise")).toHaveLength(1);
  });

  it("rejects pending service calls when the connection closes", async () => {
    const call = player.callService("/svc", {});
    await expect(Promise.all([call, drop()])).rejects.toThrow("Connection closed");
  });

  it("doesn't resubscribe a topic dropped during the outage", async () => {
    player.setSubscriptions([{ topic: "/foo" }]);
    await Promise.resolve(); // subscriptions go out once per task
    expect(ws.sentOps().map(({ op }) => op)).toContain("subscribe");
    close();
    player.setSubscriptions([]);
    await vi.advanceTimersByTimeAsync(3_000);
    connect();
    await Promise.resolve();
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

  it("rejects a service call the server reports as failed", async () => {
    const call = player.callService("/svc", {});
    ws.receive(
      JSON.stringify({ op: "serviceCallFailure", serviceId: 7, callId: 1, message: "no server" }),
    );
    await expect(call).rejects.toThrow("no server");
  });

  it("clears a status the server removes", async () => {
    ws.receive(JSON.stringify({ op: "status", level: 1, message: "Low battery", id: "battery" }));
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // the status is logged as a warning
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map((alert) => alert.message)).toContain("Low battery");

    ws.receive(JSON.stringify({ op: "removeStatus", statusIds: ["battery"] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map((alert) => alert.message)).not.toContain("Low battery");
  });

  it("handles a repeated serverInfo on the same connection", async () => {
    ws.receive(
      JSON.stringify({
        op: "serverInfo",
        name: "test",
        sessionId: "session",
        capabilities: ["clientPublish", "services", "assets"],
        supportedEncodings: ["json"],
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    const capabilities = lastState?.capabilities ?? [];
    expect(new Set(capabilities).size).toBe(capabilities.length);
    // The channel advertised before it keeps its schema
    expect(lastState?.activeData?.datatypes.has("S")).toBe(true);
  });

  it("retries an asset whose fetch failed", async () => {
    const first = player.fetchAsset("package://foo/mesh.stl");
    ws.receive(fetchAssetError(1, "not found"));
    await expect(first).rejects.toThrow("not found");

    ws.send.mockClear();
    void player.fetchAsset("package://foo/mesh.stl").catch(() => {});
    expect(ws.send).toHaveBeenCalled();
  });

  it("keeps the history, paused position and stats across a reconnect to the same session", async () => {
    await receiveFoo(3);
    player.pausePlayback();
    await vi.advanceTimersByTimeAsync(100);
    const paused = lastState?.activeData?.currentTime;

    await drop();
    connect();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(lastState?.activeData?.isPlaying).toBe(false);
    expect(lastState?.activeData?.currentTime).toEqual(paused);
    expect(stats()).toBe(3);
    expect(historyMessages()).toBe(3);
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "no server clock" while paused
  });

  it("starts over when the server comes back with a new session", async () => {
    await receiveFoo(3);
    player.pausePlayback();
    await drop();
    connect("restarted");
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.activeData?.isPlaying).toBe(true);
    expect(stats()).toBeUndefined();
    expect(historyMessages()).toBe(0);
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "no server clock" while paused
  });

  it("resubscribes once after a reconnect and takes a burst of data", async () => {
    await receiveFoo(3);
    await drop();
    connect();
    await Promise.resolve();
    const subscribes = ws.sentOps().filter(({ op }) => op === "subscribe");
    expect(subscribes).toHaveLength(1);
    await receiveFoo(5_000); // the same subscriptions: nothing new is sent
    expect(ws.sentOps().filter(({ op }) => op === "subscribe")).toHaveLength(1);
    expect(stats()).toBe(5_003);
    expect(historyMessages()).toBe(5_003);
    expect(lastState?.alerts).toEqual([
      expect.objectContaining({ message: "No server clock: history uses local receive time" }),
    ]);
  });

  it("reconnects when a silent link doesn't answer a probe", async () => {
    await vi.advanceTimersByTimeAsync(LINK_SILENCE_MS);
    // The server can't be asked about parameters, but about an asset
    expect(ws.sentOps().at(-1)).toEqual({ op: "fetchAsset", uri: "", requestId: 0 });
    const dead = ws;
    await vi.advanceTimersByTimeAsync(LINK_PROBE_TIMEOUT_MS);
    (console.warn as ReturnType<typeof vi.fn>).mockClear(); // "no data, reconnecting"
    (console.error as ReturnType<typeof vi.fn>).mockClear(); // the expected "Connection failed" alert
    expect(dead.close).toHaveBeenCalled();
    expect(lastState?.presence).toBe("RECONNECTING");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.lastInstance).not.toBe(dead);
    connect();
    // The dead socket reporting its close at last changes nothing
    dead.onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.presence).toBe("PRESENT");
  });

  it("keeps a silent link whose server answers the probe", async () => {
    await vi.advanceTimersByTimeAsync(LINK_SILENCE_MS);
    ws.receive(fetchAssetError(0, "not found"));
    await vi.advanceTimersByTimeAsync(LINK_PROBE_TIMEOUT_MS);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("doesn't judge the silence of a server it can't ask", async () => {
    await drop();
    connect("session", []);
    await vi.advanceTimersByTimeAsync(LINK_SILENCE_MS + LINK_PROBE_TIMEOUT_MS * 3);
    expect(ws.close).not.toHaveBeenCalled();
    expect(ws.sentOps()).toEqual([]);
  });

  it("backs off between failed attempts, with jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    close();
    const opened = () => MockWebSocket.lastInstance;
    let previous = opened();
    for (const delay of [1_000, 2_000, 4_000, 8_000, 15_000, 15_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(opened()).toBe(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(opened()).not.toBe(previous);
      previous = opened();
      previous!.onclose?.({ code: 1006 }); // the server is still unreachable
      (console.error as ReturnType<typeof vi.fn>).mockClear();
    }
  });

  it("fails an asset fetch while the next connection is still opening, sending nothing", async () => {
    await drop();
    const next = MockWebSocket.lastInstance!;
    await expect(player.fetchAsset("package://foo/mesh.stl")).rejects.toThrow("not supported");
    expect(next.send).not.toHaveBeenCalled();
  });

  it("lets a second channel on a topic take over when the first goes", async () => {
    ws.receive(JSON.stringify({ op: "advertise", channels: [{ ...CHANNEL, id: 2 }] }));
    player.setSubscriptions([{ topic: "/foo" }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map(({ message }) => message)).toContainEqual(
      expect.stringContaining("Multiple channels"),
    );
    (console.error as ReturnType<typeof vi.fn>).mockClear();
    expect(lastState?.activeData?.topics).toHaveLength(1);

    ws.receive(JSON.stringify({ op: "unadvertise", channelIds: [1] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(ws.sentOps().at(-1)).toEqual({
      op: "subscribe",
      subscriptions: [{ id: 1, channelId: 2 }],
    });
    expect(lastState?.activeData?.topics).toEqual([{ name: "/foo", schemaName: "S" }]);
    expect(lastState?.alerts ?? []).not.toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Multiple channels") }),
    );
    // Data the first channel's subscription had on its way doesn't warn
    ws.receive(messageData(0, 1n));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map(({ message }) => message) ?? []).not.toContainEqual(
      expect.stringContaining("unknown subscription"),
    );
  });

  it("forgets unsupported channels on reconnect", async () => {
    ws.receive(
      JSON.stringify({ op: "advertise", channels: [{ ...CHANNEL, id: 5, encoding: "unknown" }] }),
    );
    await drop();
    connect();
    ws.receive(JSON.stringify({ op: "unadvertise", channelIds: [5] }));
    await vi.advanceTimersByTimeAsync(100);
    (console.error as ReturnType<typeof vi.fn>).mockClear();
    expect(lastState?.alerts?.map(({ message }) => message)).toContain(
      "Server unadvertised channel 5 that was not advertised",
    );
  });

  it("keeps alerts of broken channels when the session changes on an open connection", async () => {
    ws.receive(
      JSON.stringify({ op: "advertise", channels: [{ ...CHANNEL, id: 5, encoding: "unknown" }] }),
    );
    ws.receive(
      JSON.stringify({ op: "serverInfo", name: "test", sessionId: "other", capabilities: [] }),
    );
    await vi.advanceTimersByTimeAsync(100);
    (console.error as ReturnType<typeof vi.fn>).mockClear();
    expect(lastState?.alerts?.map(({ message }) => message)).toContain(
      "Failed to parse channel schema on /foo",
    );
  });

  it("clears the schema alert of a broken channel once the server unadvertises it", async () => {
    ws.receive(
      JSON.stringify({ op: "advertise", channels: [{ ...CHANNEL, id: 5, encoding: "unknown" }] }),
    );
    await vi.advanceTimersByTimeAsync(100);
    (console.error as ReturnType<typeof vi.fn>).mockClear();
    expect(lastState?.alerts?.map(({ message }) => message)).toContain(
      "Failed to parse channel schema on /foo",
    );
    ws.receive(JSON.stringify({ op: "unadvertise", channelIds: [5] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map(({ message }) => message) ?? []).not.toContain(
      "Failed to parse channel schema on /foo",
    );
  });

  it("doesn't keep a ghost topic when a channel id is advertised again on another topic", async () => {
    ws.receive(JSON.stringify({ op: "advertise", channels: [{ ...CHANNEL, topic: "/bar" }] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.activeData?.topics.map(({ name }) => name)).toEqual(["/bar"]);
    ws.receive(JSON.stringify({ op: "unadvertise", channelIds: [CHANNEL.id] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.activeData?.topics ?? []).toEqual([]);
  });

  it("keeps a subscription when its channel is advertised again unchanged", async () => {
    player.setSubscriptions([{ topic: "/foo" }]);
    await Promise.resolve();
    ws.send.mockClear();
    ws.receive(JSON.stringify({ op: "advertise", channels: [CHANNEL] }));
    await vi.advanceTimersByTimeAsync(100);
    expect(ws.sentOps().map(({ op }) => op)).not.toContain("subscribe");
  });

  it("keeps ignoring late data of a canceled subscription across a reconnect", async () => {
    player.setSubscriptions([{ topic: "/foo" }]);
    await Promise.resolve();
    player.setSubscriptions([]); // subscription 0 canceled: late data ignored for 2 s
    await drop(); // t = 1 s
    connect();
    player.setSubscriptions([{ topic: "/foo" }]); // the new client's subscription 0
    await vi.advanceTimersByTimeAsync(500); // t = 1.5 s
    player.setSubscriptions([]); // canceled: ignored until t = 3.5 s
    await vi.advanceTimersByTimeAsync(600); // t = 2.1 s: past the first cancel's 2 s
    ws.receive(messageData(0, 1n));
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.alerts?.map(({ message }) => message) ?? []).not.toContainEqual(
      expect.stringContaining("unknown subscription"),
    );
  });

  it("doesn't send a parameter while the next connection is opening", async () => {
    await drop();
    connect("session", ["parameters"]);
    close(); // the next socket is still connecting
    for (let i = 0; i < 60 && MockWebSocket.lastInstance === ws; i++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    const next = MockWebSocket.lastInstance!;
    expect(() => {
      player.setParameter("/p", 1);
    }).toThrow();
    expect(next.send).not.toHaveBeenCalled();
  });

  it("backs off from a server that drops every connection right after serverInfo", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (const delay of [1_000, 2_000, 4_000]) {
      const previous = MockWebSocket.lastInstance;
      close(); // dropped right after introducing itself
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(MockWebSocket.lastInstance).toBe(previous);
      await vi.advanceTimersByTimeAsync(1);
      expect(MockWebSocket.lastInstance).not.toBe(previous);
      connect();
    }
    // A connection that stays up (and keeps talking, so the link check is happy) starts the
    // backoff over
    for (let t = 0; t < STABLE_CONNECTION_MS; t += 5_000) {
      ws.receive(JSON.stringify({ op: "advertise", channels: [CHANNEL] }));
      await vi.advanceTimersByTimeAsync(5_000);
    }
    const stable = MockWebSocket.lastInstance;
    close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(MockWebSocket.lastInstance).not.toBe(stable);
  });

  it("calls services that name their own encoding when the server lists none", async () => {
    await drop();
    connect("session", ["services"], []);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.capabilities).toContain("callServices");
    ws.send.mockClear();
    const call = player.callService("/svc", {});
    expect(ws.send).toHaveBeenCalledTimes(1);
    await Promise.all([expect(call).rejects.toThrow("Connection closed"), drop()]);
  });
});

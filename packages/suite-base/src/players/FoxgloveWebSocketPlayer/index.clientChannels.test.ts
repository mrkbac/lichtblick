// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { PlayerState } from "@lichtblick/suite-base/players/types";

import { GET_ALL_PARAMS_REQUEST_ID } from "./constants";
import FoxgloveWebSocketPlayer from "./index";

type SentOp = {
  op: string;
  channels?: { topic: string; schema?: string; schemaEncoding?: string }[];
  parameterNames?: string[];
};

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

  public receiveJson(data: unknown): void {
    this.receive(JSON.stringify(data));
  }

  public sentOps(): SentOp[] {
    return this.send.mock.calls
      .map(([data]) => data)
      .filter((data): data is string => typeof data === "string")
      .map((data) => JSON.parse(data) as SentOp);
  }
}

const JSON_SCHEMA = JSON.stringify({ type: "object", properties: { a: { type: "number" } } });

/** ServiceCallResponse (op 3) */
function serviceCallResponse(serviceId: number, callId: number, encoding: string, data: string) {
  const enc = new TextEncoder().encode(encoding);
  const payload = new TextEncoder().encode(data);
  const bytes = new Uint8Array(13 + enc.length + payload.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = 3;
  view.setUint32(1, serviceId, true);
  view.setUint32(5, callId, true);
  view.setUint32(9, enc.length, true);
  bytes.set(enc, 13);
  bytes.set(payload, 13 + enc.length);
  return bytes.buffer;
}

describe("FoxgloveWebSocketPlayer client channels, parameters and services", () => {
  let player: FoxgloveWebSocketPlayer;
  let ws: MockWebSocket;
  let lastState: PlayerState | undefined;

  function connect(capabilities: string[], supportedEncodings: string[]) {
    ws = MockWebSocket.lastInstance!;
    ws.onopen?.({});
    ws.receiveJson({
      op: "serverInfo",
      name: "test",
      sessionId: "session",
      capabilities,
      supportedEncodings,
    });
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
  });

  afterEach(() => {
    player.close();
    vi.useRealTimers();
    delete (global as { WebSocket?: unknown }).WebSocket;
  });

  it("sends the ROS message definition when advertising a client channel", () => {
    connect(["clientPublish"], ["ros1"]);
    ws.receiveJson({
      op: "advertise",
      channels: [
        { id: 1, topic: "/in", encoding: "ros1", schemaName: "pkg/Msg", schema: "string data" },
      ],
    });
    player.setPublishers([{ topic: "/out", schemaName: "pkg/Msg" }]);

    const advertise = ws.sentOps().find(({ op }) => op === "advertise");
    expect(advertise?.channels?.[0]).toMatchObject({
      topic: "/out",
      schemaEncoding: "ros1msg",
      schema: "string data",
    });
  });

  it("sends a known JSON schema when advertising a json client channel", () => {
    connect(["clientPublish"], ["json"]);
    ws.receiveJson({
      op: "advertise",
      channels: [{ id: 1, topic: "/in", encoding: "json", schemaName: "S", schema: JSON_SCHEMA }],
    });
    player.setPublishers([
      { topic: "/out", schemaName: "S" },
      { topic: "/other", schemaName: "Unknown" },
    ]);

    const channels = ws.sentOps().flatMap(({ op, channels: c }) => (op === "advertise" ? c : []));
    expect(channels.find((c) => c?.topic === "/out")).toMatchObject({
      schemaEncoding: "jsonschema",
      schema: JSON_SCHEMA,
    });
    const other = channels.find((c) => c?.topic === "/other");
    expect(other).toBeDefined();
    expect(other).not.toHaveProperty("schema");
  });

  it("keeps the datatypes map identity when an advertise brings no new types", async () => {
    connect([], ["json"]);
    ws.receiveJson({
      op: "advertise",
      channels: [{ id: 1, topic: "/a", encoding: "json", schemaName: "S", schema: JSON_SCHEMA }],
    });
    await vi.advanceTimersByTimeAsync(100);
    const datatypes = lastState?.activeData?.datatypes;
    expect(datatypes?.has("S")).toBe(true);

    // Same schema on another topic, then an unadvertise: no new types
    ws.receiveJson({
      op: "advertise",
      channels: [{ id: 2, topic: "/b", encoding: "json", schemaName: "S", schema: JSON_SCHEMA }],
    });
    ws.receiveJson({ op: "unadvertise", channelIds: [2] });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.activeData?.datatypes).toBe(datatypes);

    ws.receiveJson({
      op: "advertise",
      channels: [{ id: 3, topic: "/c", encoding: "json", schemaName: "T", schema: JSON_SCHEMA }],
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(lastState?.activeData?.datatypes).not.toBe(datatypes);
    expect(lastState?.activeData?.datatypes.has("T")).toBe(true);
  });

  it("unsubscribes parameters that drop out and deletes unset ones", async () => {
    connect(["parameters", "parametersSubscribe"], ["json"]);
    ws.receiveJson({
      op: "advertise",
      channels: [{ id: 1, topic: "/a", encoding: "json", schemaName: "S", schema: JSON_SCHEMA }],
    });
    ws.receiveJson({
      op: "parameterValues",
      id: GET_ALL_PARAMS_REQUEST_ID,
      parameters: [
        { name: "/a", value: 1 },
        { name: "/b", value: 2 },
        { name: "/c", value: 3 },
      ],
    });
    ws.receiveJson({
      op: "parameterValues",
      id: GET_ALL_PARAMS_REQUEST_ID,
      parameters: [
        { name: "/a", value: 1 },
        { name: "/c", value: 3 },
      ],
    });
    // An update without a value means the parameter was unset
    ws.receiveJson({ op: "parameterValues", parameters: [{ name: "/c" }] });
    await vi.advanceTimersByTimeAsync(100);

    expect(ws.sentOps().filter(({ op }) => op === "unsubscribeParameterUpdates")).toEqual([
      { op: "unsubscribeParameterUpdates", parameterNames: ["/b"] },
    ]);
    expect(Array.from(lastState?.activeData?.parameters?.entries() ?? [])).toEqual([["/a", 1]]);
  });

  it("rejects a service response in an unexpected encoding", async () => {
    connect(["services"], ["json"]);
    const schema = { schemaEncoding: "jsonschema", schema: JSON.stringify({ type: "object" }) };
    ws.receiveJson({
      op: "advertiseServices",
      services: [
        {
          id: 7,
          name: "/svc",
          type: "svc_type",
          request: { encoding: "json", schemaName: "req", ...schema },
          response: { encoding: "json", schemaName: "res", ...schema },
        },
      ],
    });

    const call = player.callService("/svc", {});
    ws.receive(serviceCallResponse(7, 1, "cbor", "{}"));
    await expect(call).rejects.toThrow("expected 'json'");

    const ok = player.callService("/svc", {});
    ws.receive(serviceCallResponse(7, 2, "json", '{"x":1}'));
    await expect(ok).resolves.toEqual({ x: 1 });
  });
});

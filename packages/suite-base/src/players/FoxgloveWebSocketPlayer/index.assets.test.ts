// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

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
}

function binary(op: number, write: (view: DataView, bytes: Uint8Array) => void, size: number) {
  const buffer = new ArrayBuffer(1 + size);
  const view = new DataView(buffer);
  view.setUint8(0, op);
  write(view, new Uint8Array(buffer));
  return buffer;
}

/** FetchAssetResponse (op 4): request id, status 0 (success), empty error, data */
function fetchAssetResponse(requestId: number, data: Uint8Array) {
  return binary(
    4,
    (view, bytes) => {
      view.setUint32(1, requestId, true);
      view.setUint8(5, 0);
      view.setUint32(6, 0, true);
      bytes.set(data, 10);
    },
    9 + data.length,
  );
}

/** ServiceCallResponse (op 3): service id, call id, encoding, payload */
function serviceCallResponse(serviceId: number, callId: number, payload: string) {
  const encoding = new TextEncoder().encode("json");
  const data = new TextEncoder().encode(payload);
  return binary(
    3,
    (view, bytes) => {
      view.setUint32(1, serviceId, true);
      view.setUint32(5, callId, true);
      view.setUint32(9, encoding.length, true);
      bytes.set(encoding, 13);
      bytes.set(data, 13 + encoding.length);
    },
    12 + encoding.length + data.length,
  );
}

describe("FoxgloveWebSocketPlayer assets", () => {
  let player: FoxgloveWebSocketPlayer;
  let ws: MockWebSocket;

  beforeEach(async () => {
    (global as { WebSocket?: unknown }).WebSocket = MockWebSocket;
    player = new FoxgloveWebSocketPlayer({ url: "ws://test", sourceId: "foxglove-websocket" });
    player.setListener(async () => {});
    ws = MockWebSocket.lastInstance!;
    ws.onopen?.({});
    ws.receive(
      JSON.stringify({
        op: "serverInfo",
        name: "test",
        capabilities: ["services", "assets"],
        supportedEncodings: ["json"],
      }),
    );
    ws.receive(
      JSON.stringify({
        op: "advertiseServices",
        services: [
          {
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
          },
        ],
      }),
    );
    await Promise.resolve();
  });

  afterEach(() => {
    player.close();
    delete (global as { WebSocket?: unknown }).WebSocket;
  });

  it("an asset response does not drop a pending service call with the same id", async () => {
    const call = player.callService("/svc", {});
    const asset = player.fetchAsset("package://robot/mesh.stl");

    // Both counters start at 1: asset request 1 and service call 1 are in flight together
    ws.receive(fetchAssetResponse(1, new Uint8Array([1, 2, 3])));
    await expect(asset).resolves.toMatchObject({ data: new Uint8Array([1, 2, 3]) });

    ws.receive(serviceCallResponse(7, 1, '{"ok":true}'));
    await expect(call).resolves.toEqual({ ok: true });
  });
});

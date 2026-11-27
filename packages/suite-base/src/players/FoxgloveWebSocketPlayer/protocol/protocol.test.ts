// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import { FoxgloveClient, FoxgloveClientHandlers } from "./client";
import {
  BinaryOpcode,
  IWebSocket,
  PlaybackStatus,
  encodePlaybackControlRequest,
  encodeServiceCallRequest,
  parseBinaryMessage,
} from "./protocol";

function setup() {
  const sent: (string | Uint8Array)[] = [];
  const ws: IWebSocket = {
    binaryType: "",
    protocol: "foxglove.sdk.v1.1",
    onerror: undefined,
    onopen: undefined,
    onclose: undefined,
    onmessage: undefined,
    close: vi.fn(),
    send: (data) => {
      sent.push(data as string | Uint8Array);
    },
  };
  const handlers = Object.fromEntries(
    [
      "open",
      "error",
      "close",
      "serverInfo",
      "status",
      "removeStatus",
      "advertise",
      "unadvertise",
      "message",
      "time",
      "parameterValues",
      "advertiseServices",
      "unadvertiseServices",
      "serviceCallResponse",
      "serviceCallFailure",
      "connectionGraphUpdate",
      "fetchAssetResponse",
      "playbackState",
    ].map((name) => [name, vi.fn()]),
  ) as unknown as { [K in keyof FoxgloveClientHandlers]: FoxgloveClientHandlers[K] & Mock };
  const client = new FoxgloveClient({ ws, handlers });
  const receive = (data: unknown) => {
    ws.onmessage?.({ data });
  };
  return { client, handlers, receive, sent };
}

describe("protocol encoding", () => {
  it("encodes a play request with a seek", () => {
    const bytes = encodePlaybackControlRequest({
      play: true,
      speed: 2,
      seekTimeNs: 0x0102030405060708n,
      requestId: "ab",
    });
    expect(Array.from(bytes)).toEqual([
      0x03, // opcode
      0x00, // play
      ...[0x00, 0x00, 0x00, 0x40], // 2.0 as little-endian f32
      0x01, // has seek
      ...[0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01], // seek time
      ...[0x02, 0x00, 0x00, 0x00], // request id length
      0x61,
      0x62, // "ab"
    ]);
  });

  it("decodes a playback state", () => {
    const bytes = new Uint8Array([
      0x05, // opcode
      0x01, // paused
      ...[0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01], // current time
      ...[0x00, 0x00, 0x00, 0x3f], // 0.5 as little-endian f32
      0x01, // did seek
      ...[0x03, 0x00, 0x00, 0x00], // request id length
      0x61,
      0x62,
      0x63, // "abc"
    ]);
    expect(parseBinaryMessage(bytes)).toEqual({
      op: BinaryOpcode.PLAYBACK_STATE,
      status: PlaybackStatus.Paused,
      currentTimeNs: 0x0102030405060708n,
      speed: 0.5,
      didSeek: true,
      requestId: "abc",
    });
  });

  it("writes a service call encoding's length in bytes and round-trips it", () => {
    const data = new Uint8Array([9, 8, 7]);
    const bytes = encodeServiceCallRequest({
      serviceId: 1,
      callId: 2,
      encoding: "jsön",
      // A view into a larger buffer: only its own bytes go out
      data: new Uint8Array([0, ...data, 0]).subarray(1, 4),
    });
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(9, true)).toBe(5); // "ö" is two bytes in UTF-8
    // The response has the same layout after its opcode
    bytes[0] = BinaryOpcode.SERVICE_CALL_RESPONSE;
    expect(parseBinaryMessage(bytes)).toEqual({
      op: BinaryOpcode.SERVICE_CALL_RESPONSE,
      serviceId: 1,
      callId: 2,
      encoding: "jsön",
      data,
    });
  });

  it("ignores an unknown binary opcode", () => {
    expect(parseBinaryMessage(new Uint8Array([0x7f, 1, 2]))).toBeUndefined();
  });
});

describe("FoxgloveClient", () => {
  it("passes message data straight to the handler", () => {
    const { handlers, receive } = setup();
    const frame = new Uint8Array(16);
    const view = new DataView(frame.buffer);
    view.setUint8(0, BinaryOpcode.MESSAGE_DATA);
    view.setUint32(1, 7, true);
    view.setBigUint64(5, 123n, true);
    frame.set([1, 2, 3], 13);
    receive(frame.buffer);
    expect(handlers.message).toHaveBeenCalledWith(7, 123n, new Uint8Array([1, 2, 3]));
  });

  it("reports a truncated message data frame as an error", () => {
    const { handlers, receive } = setup();
    receive(new Uint8Array([BinaryOpcode.MESSAGE_DATA, 7, 0, 0, 0, 1]).buffer);
    expect(handlers.message).not.toHaveBeenCalled();
    expect(handlers.error).toHaveBeenCalledWith(expect.any(Error));
  });

  it("detaches from its socket on dispose, reporting the given close right away", () => {
    const { client, handlers, receive } = setup();
    client.dispose({ code: 1006 });
    expect(handlers.close).toHaveBeenCalledWith({ code: 1006 });
    receive(JSON.stringify({ op: "status", level: 0, message: "late" }));
    expect(handlers.status).not.toHaveBeenCalled();
  });

  it("ignores ops and opcodes from newer servers", () => {
    const { handlers, receive } = setup();
    receive(JSON.stringify({ op: "somethingNew" }));
    receive(new Uint8Array([0x7f]).buffer);
    expect(handlers.error).not.toHaveBeenCalled();
  });

  it("resolves v1.1 schema ids, including schemas from an earlier advertise", () => {
    const { handlers, receive } = setup();
    receive(JSON.stringify({ op: "serverInfo", name: "s", capabilities: [] }));
    receive(
      JSON.stringify({
        op: "advertise",
        schemas: [{ id: 1, name: "Pose", encoding: "jsonschema", data: "{}" }],
        channels: [
          { id: 10, topic: "/a", encoding: "json", schemaId: 1 },
          { id: 11, topic: "/raw", encoding: "json", metadata: { k: "v" } },
        ],
      }),
    );
    receive(
      JSON.stringify({
        op: "advertise",
        channels: [{ id: 12, topic: "/b", encoding: "json", schemaId: 1 }],
      }),
    );
    expect(handlers.advertise.mock.calls.flat(2)).toEqual([
      {
        id: 10,
        topic: "/a",
        encoding: "json",
        schemaName: "Pose",
        schema: "{}",
        schemaEncoding: "jsonschema",
      },
      {
        id: 11,
        topic: "/raw",
        encoding: "json",
        schemaName: "",
        schema: "",
        schemaEncoding: "",
        metadata: { k: "v" },
      },
      {
        id: 12,
        topic: "/b",
        encoding: "json",
        schemaName: "Pose",
        schema: "{}",
        schemaEncoding: "jsonschema",
      },
    ]);

    // A new serverInfo starts a new schema table
    receive(JSON.stringify({ op: "serverInfo", name: "s", capabilities: [] }));
    receive(
      JSON.stringify({
        op: "advertise",
        channels: [{ id: 13, topic: "/c", encoding: "json", schemaId: 1 }],
      }),
    );
    expect(handlers.advertise.mock.calls.at(-1)?.[0]).toEqual([
      { id: 13, topic: "/c", encoding: "json", schemaName: "", schema: "", schemaEncoding: "" },
    ]);
  });

  it("sends the subscriptions made in one task as one message", async () => {
    const { client, sent } = setup();
    const a = client.subscribe(1);
    const b = client.subscribe(2);
    const c = client.subscribe(3);
    client.unsubscribe(c); // never sent
    await Promise.resolve();
    client.unsubscribe(a);
    client.unsubscribe(b);
    await Promise.resolve();
    expect(sent.map((data) => JSON.parse(data as string) as unknown)).toEqual([
      {
        op: "subscribe",
        subscriptions: [
          { id: a, channelId: 1 },
          { id: b, channelId: 2 },
        ],
      },
      { op: "unsubscribe", subscriptionIds: [a, b] },
    ]);
  });
});

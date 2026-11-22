// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { UlogIterableSource } from "./UlogIterableSource";

function record(type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(3 + payload.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, payload.byteLength, true);
  out[2] = type.charCodeAt(0);
  out.set(payload, 3);
  return out;
}

const text = (s: string) => new TextEncoder().encode(s);

function data(msgId: number, timestamp: number, value: number): Uint8Array<ArrayBuffer> {
  const payload = new Uint8Array(2 + 8 + 4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, msgId, true);
  view.setBigUint64(2, BigInt(timestamp), true);
  view.setFloat32(10, value, true);
  return record("D", payload);
}

function log(timestamp: number, message: string): Uint8Array<ArrayBuffer> {
  const body = text(message);
  const payload = new Uint8Array(9 + body.byteLength);
  const view = new DataView(payload.buffer);
  payload[0] = "6".charCodeAt(0);
  view.setBigUint64(1, BigInt(timestamp), true);
  payload.set(body, 9);
  return record("L", payload);
}

function addLogged(msgId: number, name: string): Uint8Array<ArrayBuffer> {
  const body = text(name);
  const payload = new Uint8Array(3 + body.byteLength);
  new DataView(payload.buffer).setUint16(1, msgId, true);
  payload.set(body, 3);
  return record("A", payload);
}

/** Topics "a" and "b"; "b" was written out of time order */
function makeUlog(): File {
  const header = new Uint8Array(16);
  header.set([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35, 1]);
  const parts = [
    header,
    record("B", new Uint8Array(40)),
    record("F", text("a:uint64_t timestamp;float x;")),
    record("F", text("b:uint64_t timestamp;float x;")),
    addLogged(0, "a"),
    addLogged(1, "b"),
    data(0, 1_000_000, 1),
    data(1, 3_000_000, 30),
    data(1, 2_000_000, 20),
    log(2_500_000, "hello"),
    data(0, 4_000_000, 4),
  ];
  return new File(parts, "test.ulg");
}

async function read(source: UlogIterableSource, topics: string[]) {
  const out: [string, number][] = [];
  for await (const result of source.messageIterator({
    topics: new Map(topics.map((topic) => [topic, { topic }])),
  })) {
    if (result.type === "message-event") {
      out.push([result.msgEvent.topic, result.msgEvent.receiveTime.sec]);
    }
  }
  return out;
}

describe("UlogIterableSource", () => {
  it("reads messages in time order, only for the requested topics", async () => {
    const source = new UlogIterableSource({ type: "file", file: makeUlog() });
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 4, nsec: 0 });

    expect(await read(source, ["a", "b", "Log"])).toEqual([
      ["a", 1],
      ["b", 2],
      ["Log", 2],
      ["b", 3],
      ["a", 4],
    ]);
    expect(await read(source, ["b"])).toEqual([
      ["b", 2],
      ["b", 3],
    ]);
    expect(await read(source, ["Log"])).toEqual([["Log", 2]]);
  });
});

describe("UlogIterableSource backfill", () => {
  it("returns the latest message at or before the time per topic", async () => {
    const source = new UlogIterableSource({ type: "file", file: makeUlog() });
    await source.initialize();
    const messages = await source.getBackfillMessages({
      topics: new Map(["a", "b", "Log"].map((topic) => [topic, { topic }])),
      time: { sec: 3, nsec: 500_000_000 },
    });
    expect(messages.map((m) => [m.topic, m.receiveTime.sec])).toEqual([
      ["a", 1],
      ["Log", 2],
      ["b", 3],
    ]);
    expect(
      await source.getBackfillMessages({
        topics: new Map([["b", { topic: "b" }]]),
        time: { sec: 1, nsec: 0 },
      }),
    ).toEqual([]);
  });
});

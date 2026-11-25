// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import fs from "node:fs";
import path from "node:path";

import { SyncFile, WasmDataLoader } from "./WasmDataLoader";
import { WasmDataLoaderIterableSource } from "./WasmDataLoaderIterableSource";

// Built from fixtures/text_loader with the published foxglove_data_loader crate. Each input line is
// `<log_time_ns> <topic> <json>`.
const wasm = fs.readFileSync(path.join(__dirname, "fixtures/text_loader.wasm"));

function memFile(text: string): SyncFile {
  const bytes = new TextEncoder().encode(text);
  return {
    size: bytes.byteLength,
    read: (offset, length) => bytes.slice(offset, offset + length),
  };
}

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function load(files: Record<string, string>) {
  return await WasmDataLoader.create(
    wasm,
    new Map(Object.entries(files).map(([name, text]) => [name, memFile(text)])),
    log,
  );
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data);

describe("WasmDataLoader", () => {
  it("initializes, iterates and backfills a foxglove:loader module", async () => {
    const loader = await load({
      "a.txt": '30 /b {"v":3}\n10 /a {"v":1}\nbroken\n',
      "b.txt": '20 /a {"v":2}\n',
    });

    const init = loader.initialize();
    expect(log.info).toHaveBeenCalledWith("loaded 3 rows");
    expect(init.startTime).toBe(10n);
    expect(init.endTime).toBe(30n);
    expect(init.schemas).toEqual([
      {
        id: 1,
        name: "test.Value",
        encoding: "jsonschema",
        data: expect.any(Uint8Array),
      },
    ]);
    expect(decode(init.schemas[0]!.data)).toBe('{"type":"object"}');
    expect(init.channels).toEqual([
      {
        id: 1,
        schemaId: 1,
        topicName: "/b",
        messageEncoding: "json",
        messageCount: 1n,
      },
      {
        id: 2,
        schemaId: 1,
        topicName: "/a",
        messageEncoding: "json",
        messageCount: 2n,
      },
    ]);
    expect(init.problems).toEqual([
      { severity: "warn", message: "a.txt:3: malformed line", tip: undefined },
    ]);

    const all = [...loader.messages({ channels: [1, 2] })];
    expect(all.map((m) => [m.channelId, m.logTime, decode(m.data)])).toEqual([
      [2, 10n, '{"v":1}'],
      [2, 20n, '{"v":2}'],
      [1, 30n, '{"v":3}'],
    ]);
    expect(all[0]!.publishTime).toBe(10n);

    const inRange = [...loader.messages({ channels: [2], start: 15n, end: 30n })];
    expect(inRange.map((m) => m.logTime)).toEqual([20n]);

    expect(loader.backfill(25n, [1, 2]).map((m) => [m.channelId, m.logTime])).toEqual([[2, 20n]]);
  });

  it("surfaces loader errors", async () => {
    const loader = await load({ "a.txt": "notanumber /a {}\n" });
    expect(() => loader.initialize()).toThrow("invalid digit");
  });

  it("rejects modules with imports outside the loader world", async () => {
    // (module (import "wasi_snapshot_preview1" "fd_write" (func)))
    const bytes = Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 35, 1, 22, 119, 97, 115, 105, 95, 115, 110,
      97, 112, 115, 104, 111, 116, 95, 112, 114, 101, 118, 105, 101, 119, 49, 8, 102, 100, 95, 119,
      114, 105, 116, 101, 0, 0,
    ]);
    await expect(WasmDataLoader.create(bytes, new Map(), log)).rejects.toThrow(
      "wasi_snapshot_preview1.fd_write",
    );
  });
});

describe("WasmDataLoaderIterableSource", () => {
  it("plays a loader's channels as serialized topics", async () => {
    const source = new WasmDataLoaderIterableSource(
      wasm,
      new Map([["a.txt", memFile('1000000000 /a {"v":1}\n2000000000 /a {"v":2}\n')]]),
    );

    const init = await source.initialize();
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 2, nsec: 0 });
    expect(init.topics).toEqual([
      {
        name: "/a",
        schemaName: "test.Value",
        messageEncoding: "json",
        schemaEncoding: "jsonschema",
        schemaData: expect.any(Uint8Array),
      },
    ]);
    expect(init.topicStats.get("/a")).toEqual({ numMessages: 2 });
    expect(init.datatypes.has("test.Value")).toBe(true);

    const events = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/a", { topic: "/a" }]]),
      start: { sec: 1, nsec: 500_000_000 },
    })) {
      events.push(result);
    }
    expect(events).toEqual([
      {
        type: "message-event",
        msgEvent: expect.objectContaining({
          topic: "/a",
          receiveTime: { sec: 2, nsec: 0 },
          schemaName: "test.Value",
          sizeInBytes: 7,
        }),
      },
    ]);

    const backfill = await source.getBackfillMessages({
      topics: new Map([["/a", { topic: "/a" }]]),
      time: { sec: 1, nsec: 500_000_000 },
    });
    expect(backfill.map((m) => m.receiveTime)).toEqual([{ sec: 1, nsec: 0 }]);
  });
});

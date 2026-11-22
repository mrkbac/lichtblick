// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { SqliteSqljs } from "@foxglove/rosbag2-web";
import initSqlJs from "@foxglove/sql.js";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { BLOCK_SIZE, BlockCachedFile } from "./BlockCachedFile";
import { RosDb3IterableSource } from "./RosDb3IterableSource";

// sql.js reads a File-backed database through FileReaderSync (workers only). Emulate it for files
// whose slice() returns bytes.
let fileReads = 0;
class BytesFile extends File {
  readonly #bytes: Uint8Array<ArrayBuffer>;
  public constructor(bytes: Uint8Array<ArrayBuffer>) {
    super([bytes], "test.db3");
    this.#bytes = bytes;
  }
  public override slice(start = 0, end = this.size): Blob {
    return { bytes: this.#bytes.subarray(start, end) } as unknown as Blob;
  }
}
globalThis.FileReaderSync = class {
  public readAsArrayBuffer(blob: Blob): ArrayBuffer {
    fileReads++;
    return (blob as unknown as { bytes: Uint8Array }).bytes.slice().buffer;
  }
} as unknown as typeof FileReaderSync;

const wasm = fs.readFileSync(
  path.join(
    path.dirname(createRequire(import.meta.url).resolve("@foxglove/sql.js/package.json")),
    "dist/sql-wasm.wasm",
  ),
);

function ns(sec: number): bigint {
  return BigInt(sec) * 1_000_000_000n;
}

/** A .db3 with a "fast" topic at 10 Hz for 100 s and a "rare" one at 1 s and 50 s */
async function makeDb3(): Promise<Uint8Array<ArrayBuffer>> {
  const SQL = await initSqlJs({ wasmBinary: wasm });
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      serialization_format TEXT NOT NULL, offered_qos_profiles TEXT NOT NULL);
    CREATE TABLE messages(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX timestamp_idx ON messages (timestamp ASC);
    INSERT INTO topics VALUES (1, '/fast', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (2, '/rare', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (3, '/dense', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (4, '/tied', 'std_msgs/msg/String', 'cdr', '[]');
  `);
  const insert = db.prepare("INSERT INTO messages (topic_id, timestamp, data) VALUES (?, ?, ?)");
  for (let i = 0; i <= 1000; i++) {
    // ~5 KiB messages so the file spans several blocks
    insert.run([1, (ns(100) + BigInt(i) * 100_000_000n).toString(), new Uint8Array(5000).fill(i)]);
  }
  insert.run([2, ns(101).toString(), new Uint8Array([1])]);
  // 10,000 rows from 120 s to 130 s: several backfill pages without another topic
  for (let i = 0; i < 10_000; i++) {
    insert.run([3, (ns(120) + BigInt(i) * 1_000_000n).toString(), new Uint8Array([3])]);
  }
  insert.run([2, ns(150).toString(), new Uint8Array([2])]);
  // /tied's only row, then 4,097 /dense rows at the same time: more than one backfill page
  insert.run([4, ns(99).toString(), new Uint8Array([4])]);
  for (let i = 0; i < 4097; i++) {
    insert.run([3, ns(99).toString(), new Uint8Array([3])]);
  }
  insert.free();
  return db.export() as Uint8Array<ArrayBuffer>;
}

describe("RosDb3IterableSource", () => {
  let db3: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    db3 = await makeDb3();
  });

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(wasm));
  });

  async function open() {
    const source = new RosDb3IterableSource([new BytesFile(db3)]);
    const init = await source.initialize();
    return { source, init };
  }

  it("reads every message", async () => {
    const { source, init } = await open();
    expect(init.topicStats.get("/fast")?.numMessages).toBe(1001);
    const topics = new Map([
      ["/fast", { topic: "/fast" }],
      ["/rare", { topic: "/rare" }],
    ]);
    let count = 0;
    for await (const result of source.messageIterator({ topics })) {
      if (result.type === "message-event") {
        count++;
      }
    }
    expect(count).toBe(1003);
  });

  it("backfills the latest message at or before the time per topic", async () => {
    const { source } = await open();
    const messages = await source.getBackfillMessages({
      topics: new Map([
        ["/fast", { topic: "/fast" }],
        ["/rare", { topic: "/rare" }],
      ]),
      time: { sec: 180, nsec: 0 },
    });
    expect(messages.map((m) => [m.topic, m.receiveTime])).toEqual([
      ["/rare", { sec: 150, nsec: 0 }],
      ["/fast", { sec: 180, nsec: 0 }],
    ]);

    const before = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 149, nsec: 999_999_999 },
    });
    expect(before.map((m) => m.receiveTime)).toEqual([{ sec: 101, nsec: 0 }]);

    const none = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 100, nsec: 0 },
    });
    expect(none).toEqual([]);
  });

  it("pages a backfill by rows and stops when the seek is superseded", async () => {
    const { source } = await open();
    const realSetTimeout = globalThis.setTimeout;
    let yields = 0;
    let abortAt = Infinity;
    const abort = new AbortController();
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      if (++yields === abortAt) {
        abort.abort();
      }
      return realSetTimeout(fn, ms);
    }) as typeof setTimeout);
    // 10,000 /dense rows lie between 135 s and /rare's message at 101 s
    const args = {
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 135, nsec: 0 },
    };

    const messages = await source.getBackfillMessages(args);
    expect(messages.map((m) => m.receiveTime)).toEqual([{ sec: 101, nsec: 0 }]);
    // Pages without a match still yield to the worker
    expect(yields).toBeGreaterThanOrEqual(3);

    yields = 0;
    abortAt = 2;
    await expect(
      source.getBackfillMessages({ ...args, abortSignal: abort.signal }),
    ).rejects.toThrow();
  });

  it("bounds each backfill page by rows, matching or not", async () => {
    await SqliteSqljs.Initialize({ wasmBinary: wasm });
    const db = new SqliteSqljs(new BlockCachedFile(new BytesFile(db3)));
    await db.open();
    // The 100 rows back from 135 s (51 /fast, 49 /dense) hold no /rare: the page ends anyway
    const page = db.backfillPage({ timestamp: ns(135) }, ["/rare"], 100);
    expect(page.found).toEqual([]);
    expect(page.next?.timestamp).toBe(129_951_000_000n);
    await db.close();
  });

  it("doesn't skip rows tied at a backfill page boundary", async () => {
    const { source } = await open();
    const messages = await source.getBackfillMessages({
      topics: new Map([["/tied", { topic: "/tied" }]]),
      time: { sec: 99, nsec: 0 },
    });
    expect(messages.map((m) => m.receiveTime)).toEqual([{ sec: 99, nsec: 0 }]);
  });

  it("only scans the files of a split recording that have the topic", async () => {
    const SQL = await initSqlJs({ wasmBinary: wasm });
    const other = new SQL.Database();
    other.run(`
      CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
        serialization_format TEXT NOT NULL, offered_qos_profiles TEXT NOT NULL);
      CREATE TABLE messages(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL,
        timestamp INTEGER NOT NULL, data BLOB NOT NULL);
      CREATE INDEX timestamp_idx ON messages (timestamp ASC);
      INSERT INTO topics VALUES (1, '/fast', 'std_msgs/msg/String', 'cdr', '[]');
      INSERT INTO messages VALUES (1, 1, ${ns(300)}, x'00');
    `);
    const source = new RosDb3IterableSource([
      new BytesFile(db3),
      new BytesFile(other.export() as Uint8Array<ArrayBuffer>),
    ]);
    await source.initialize();
    const pages = vi.spyOn(SqliteSqljs.prototype, "backfillPage");
    const messages = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 400, nsec: 0 },
    });
    expect(messages.map((m) => m.receiveTime)).toEqual([{ sec: 150, nsec: 0 }]);
    // All pages came from the first file
    expect(new Set(pages.mock.contexts).size).toBe(1);
  });

  it("reads the file in blocks", async () => {
    const { source } = await open();
    fileReads = 0;
    const topics = new Map([["/fast", { topic: "/fast" }]]);
    let count = 0;
    for await (const result of source.messageIterator({ topics })) {
      count += result.type === "message-event" ? 1 : 0;
    }
    expect(count).toBe(1001);
    // ~5 MB of messages in 1 MiB reads (some blocks evicted and re-read at most once more)
    expect(fileReads).toBeLessThanOrEqual(2 * Math.ceil(db3.byteLength / BLOCK_SIZE));
  });
});

describe("BlockCachedFile", () => {
  it("returns the bytes of reads that span blocks", () => {
    const bytes = new Uint8Array(3 * BLOCK_SIZE + 10).map((_, i) => i % 251);
    const file = new BlockCachedFile(new BytesFile(bytes));
    const reader = new FileReaderSync();
    const read = (start: number, end: number) =>
      new Uint8Array(reader.readAsArrayBuffer(file.slice(start, end)));

    expect(read(BLOCK_SIZE - 5, BLOCK_SIZE + 5)).toEqual(
      bytes.slice(BLOCK_SIZE - 5, BLOCK_SIZE + 5),
    );
    expect(read(3 * BLOCK_SIZE, 3 * BLOCK_SIZE + 100)).toEqual(bytes.slice(3 * BLOCK_SIZE));
    expect(read(0, 3 * BLOCK_SIZE + 10)).toEqual(bytes);
    expect(file.size).toBe(bytes.byteLength);
  });

  it("reads each block from the file once", () => {
    const file = new BlockCachedFile(new BytesFile(new Uint8Array(2 * BLOCK_SIZE)));
    const reader = new FileReaderSync();
    fileReads = 0;
    for (let offset = 0; offset < 2 * BLOCK_SIZE; offset += 4096) {
      reader.readAsArrayBuffer(file.slice(offset, offset + 4096));
    }
    expect(fileReads).toBe(2);
  });
});

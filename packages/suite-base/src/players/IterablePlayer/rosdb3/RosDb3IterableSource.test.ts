// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import initSqlite from "@sqlite.org/sqlite-wasm";

import { BLOCK_SIZE, BlockCachedFile } from "./BlockCachedFile";
import { RosDb3IterableSource } from "./RosDb3IterableSource";
import { SqliteRosDb3 } from "./SqliteRosDb3";

// FileReaderSync is only available in browser workers. Emulate it for slices backed by bytes.
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
beforeEach(() => {
  vi.stubGlobal(
    "FileReaderSync",
    class {
      public readAsArrayBuffer(blob: Blob): ArrayBuffer {
        fileReads++;
        return (blob as unknown as { bytes: Uint8Array<ArrayBuffer> }).bytes.slice().buffer;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ns(sec: number): bigint {
  return BigInt(sec) * 1_000_000_000n;
}

const DB3_SCHEMA = `
    CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      serialization_format TEXT NOT NULL, offered_qos_profiles TEXT NOT NULL);
    CREATE TABLE messages(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL, data BLOB NOT NULL);
    CREATE INDEX timestamp_idx ON messages (timestamp ASC);
`;

/** A .db3 with a "fast" topic at 10 Hz for 100 s and a "rare" one at 1 s and 50 s */
async function makeDb3({
  metadata,
  lateMessage,
}: {
  metadata?: string;
  lateMessage?: boolean;
} = {}): Promise<Uint8Array<ArrayBuffer>> {
  const sqlite = await initSqlite();
  const db = new sqlite.oo1.DB();
  db.exec(`${DB3_SCHEMA}
    INSERT INTO topics VALUES (1, '/fast', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (2, '/rare', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (3, '/dense', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (4, '/tied', 'std_msgs/msg/String', 'cdr', '[]');
    INSERT INTO topics VALUES (5, '/empty', 'std_msgs/msg/String', 'cdr', '[]');
  `);
  db.exec("BEGIN");
  const insert = db.prepare("INSERT INTO messages (topic_id, timestamp, data) VALUES (?, ?, ?)");
  for (let i = 0; i <= 1000; i++) {
    // ~5 KiB messages so the file spans several blocks
    insert.bind([1, ns(100) + BigInt(i) * 100_000_000n, new Uint8Array(5000).fill(i)]).stepReset();
  }
  insert.bind([2, ns(101), new Uint8Array([1])]).stepReset();
  // 10,000 rows from 120 s to 130 s: several backfill pages without another topic
  for (let i = 0; i < 10_000; i++) {
    insert.bind([3, ns(120) + BigInt(i) * 1_000_000n, new Uint8Array([3])]).stepReset();
  }
  insert.bind([2, ns(150), new Uint8Array([2])]).stepReset();
  // /tied's only row, then 4,097 /dense rows at the same time: more than one backfill page
  insert.bind([4, ns(99), new Uint8Array([4])]).stepReset();
  for (let i = 0; i < 4097; i++) {
    insert.bind([3, ns(99), new Uint8Array([3])]).stepReset();
  }
  if (lateMessage === true) {
    insert.bind([2, ns(170), new Uint8Array([3])]).stepReset();
  }
  insert.finalize();
  db.exec("COMMIT");
  if (metadata != undefined) {
    db.exec(
      "CREATE TABLE metadata(id INTEGER PRIMARY KEY, metadata_version INTEGER, metadata TEXT)",
    );
    db.exec({
      sql: "INSERT INTO metadata VALUES (1, 9, 'unfinished'), (2, 9, ?)",
      bind: [metadata],
    });
  }
  const bytes = sqlite.capi.sqlite3_js_db_export(db);
  db.close();
  return bytes;
}

const metadata = `
storage_identifier: sqlite3
relative_file_paths: [test.db3]
starting_time: {nanoseconds_since_epoch: 99000000000}
duration: {nanoseconds: 101000000000}
message_count: 15101
topics_with_message_count:
  - {topic_metadata: {name: /fast}, message_count: 1001}
  - {topic_metadata: {name: /rare}, message_count: 2}
  - {topic_metadata: {name: /dense}, message_count: 14097}
  - {topic_metadata: {name: /tied}, message_count: 1}
  - {topic_metadata: {name: /empty}, message_count: 0}
`;

describe("RosDb3IterableSource", () => {
  let db3: Uint8Array<ArrayBuffer>;

  beforeAll(async () => {
    db3 = await makeDb3();
  });

  const sources: RosDb3IterableSource[] = [];
  afterEach(async () => {
    for (const source of sources.splice(0)) {
      await source.terminate();
    }
  });

  async function open() {
    const source = new RosDb3IterableSource([new BytesFile(db3)]);
    const init = await source.initialize();
    sources.push(source);
    return { source, init };
  }

  it("uses the latest embedded topic counts without scanning messages", async () => {
    const scan = vi.spyOn(SqliteRosDb3.prototype, "messageCounts");
    const source = new RosDb3IterableSource([new BytesFile(await makeDb3({ metadata }))]);
    sources.push(source);
    const init = await source.initialize();
    expect(init.topicStats.get("/rare")).toEqual({ numMessages: 2 });
    expect(scan).not.toHaveBeenCalled();

    const backfill = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 180, nsec: 0 },
    });
    expect(backfill.map((message) => message.receiveTime)).toEqual([{ sec: 150, nsec: 0 }]);
  });

  it("reuses an empty backfill prefix without skipping newer messages", async () => {
    const source = new RosDb3IterableSource([new BytesFile(await makeDb3({ metadata }))]);
    sources.push(source);
    await source.initialize();
    const pages = vi.spyOn(SqliteRosDb3.prototype, "backfillPage");
    const empty = new Map([["/empty", { topic: "/empty" }]]);
    await expect(
      source.getBackfillMessages({ topics: empty, time: { sec: 200, nsec: 0 } }),
    ).resolves.toEqual([]);
    expect(pages).toHaveBeenCalled();
    pages.mockClear();
    await expect(
      source.getBackfillMessages({ topics: empty, time: { sec: 160, nsec: 0 } }),
    ).resolves.toEqual([]);
    expect(pages).not.toHaveBeenCalled();

    const rare = new Map([["/rare", { topic: "/rare" }]]);
    await expect(
      source.getBackfillMessages({ topics: rare, time: { sec: 100, nsec: 0 } }),
    ).resolves.toEqual([]);
    const later = await source.getBackfillMessages({ topics: rare, time: { sec: 180, nsec: 0 } });
    expect(later.map((message) => message.receiveTime)).toEqual([{ sec: 150, nsec: 0 }]);
  });

  it("rejects stale counts after an append within the existing time range", async () => {
    const source = new RosDb3IterableSource([
      new BytesFile(await makeDb3({ metadata, lateMessage: true })),
    ]);
    sources.push(source);
    const scan = vi.spyOn(SqliteRosDb3.prototype, "messageCounts");
    const init = await source.initialize();
    expect(scan).toHaveBeenCalledOnce();
    expect(init.topicStats.get("/rare")).toEqual({ numMessages: 3 });
  });

  it("backfills real messages even if embedded counts say a topic is empty", async () => {
    const inaccurate = metadata
      .replace("{name: /rare}, message_count: 2", "{name: /rare}, message_count: 0")
      .replace("{name: /dense}, message_count: 14097", "{name: /dense}, message_count: 14099");
    const source = new RosDb3IterableSource([
      new BytesFile(await makeDb3({ metadata: inaccurate })),
    ]);
    sources.push(source);
    const scan = vi.spyOn(SqliteRosDb3.prototype, "messageCounts");
    await source.initialize();
    expect(scan).not.toHaveBeenCalled();

    const backfill = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 180, nsec: 0 },
    });
    expect(backfill.map((message) => message.receiveTime)).toEqual([{ sec: 150, nsec: 0 }]);
  });

  it.each([
    ["malformed", "not [a valid yaml document"],
    ["stale", metadata.replace("101000000000", "99000000000")],
    ["split-wide", metadata.replace("[test.db3]", "[first.db3, test.db3]")],
  ])("scans messages when embedded metadata is %s", async (_case, text) => {
    const source = new RosDb3IterableSource([new BytesFile(await makeDb3({ metadata: text }))]);
    sources.push(source);
    const scan = vi.spyOn(SqliteRosDb3.prototype, "messageCounts");
    const init = await source.initialize();
    expect(init.topicStats.get("/rare")).toEqual({ numMessages: 2 });
    expect(scan).toHaveBeenCalledOnce();
  });

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
    const db = new SqliteRosDb3(new BytesFile(db3));
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
    const sqlite = await initSqlite();
    const other = new sqlite.oo1.DB();
    other.exec(`
      ${DB3_SCHEMA}
      INSERT INTO topics VALUES (2, '/fast', 'std_msgs/msg/String', 'cdr', '[]');
      INSERT INTO messages VALUES (1, 2, ${ns(1_700_000_000) + 1n}, x'CAFE');
    `);
    const source = new RosDb3IterableSource([
      new BytesFile(db3),
      new BytesFile(sqlite.capi.sqlite3_js_db_export(other)),
    ]);
    other.close();
    const init = await source.initialize();
    expect(init.topicStats.get("/fast")?.numMessages).toBe(1002);
    expect(init.end).toEqual({ sec: 1_700_000_000, nsec: 1 });
    const topics = new Map([["/fast", { topic: "/fast" }]]);
    let count = 0;
    let last;
    for await (const message of source.messageIterator({ topics })) {
      count++;
      last = message;
    }
    expect(count).toBe(1002);
    expect(last).toMatchObject({
      type: "message-event",
      msgEvent: {
        topic: "/fast",
        receiveTime: { sec: 1_700_000_000, nsec: 1 },
        message: new Uint8Array([0xca, 0xfe]),
      },
    });

    const pages = vi.spyOn(SqliteRosDb3.prototype, "backfillPage");
    const messages = await source.getBackfillMessages({
      topics: new Map([["/rare", { topic: "/rare" }]]),
      time: { sec: 400, nsec: 0 },
    });
    expect(messages.map((m) => m.receiveTime)).toEqual([{ sec: 150, nsec: 0 }]);
    // All pages came from the first file
    expect(new Set(pages.mock.contexts).size).toBe(1);
    await source.terminate();
  });

  it("closes all split file handles after initialization fails", async () => {
    const badFile = new BytesFile(new Uint8Array(4096));
    const source = new RosDb3IterableSource([new BytesFile(db3), badFile]);
    const close = vi.spyOn(SqliteRosDb3.prototype, "close");
    await expect(source.initialize()).rejects.toThrow(/not a database/);
    expect(close).toHaveBeenCalledTimes(2);
    close.mockRestore();
  });

  it("closes an empty recording", async () => {
    const sqlite = await initSqlite();
    const empty = new sqlite.oo1.DB();
    empty.exec(DB3_SCHEMA);
    const source = new RosDb3IterableSource([
      new BytesFile(sqlite.capi.sqlite3_js_db_export(empty)),
    ]);
    empty.close();
    const close = vi.spyOn(SqliteRosDb3.prototype, "close");
    await expect(source.initialize()).rejects.toThrow("Bag contains no messages");
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
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
    const read = (start: number, end: number) => {
      const buffer = new Uint8Array(end - start);
      return buffer.subarray(0, file.readInto(buffer, start));
    };

    expect(read(BLOCK_SIZE - 5, BLOCK_SIZE + 5)).toEqual(
      bytes.slice(BLOCK_SIZE - 5, BLOCK_SIZE + 5),
    );
    expect(read(3 * BLOCK_SIZE, 3 * BLOCK_SIZE + 100)).toEqual(bytes.slice(3 * BLOCK_SIZE));
    expect(read(0, 3 * BLOCK_SIZE + 10)).toEqual(bytes);
    expect(file.size).toBe(bytes.byteLength);
  });

  it("reads each block from the file once", () => {
    const file = new BlockCachedFile(new BytesFile(new Uint8Array(2 * BLOCK_SIZE)));
    const page = new Uint8Array(4096);
    fileReads = 0;
    for (let offset = 0; offset < 2 * BLOCK_SIZE; offset += 4096) {
      file.readInto(page, offset);
    }
    expect(fileReads).toBe(2);
  });
});

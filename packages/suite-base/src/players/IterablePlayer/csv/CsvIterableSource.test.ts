// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import { CsvIterableSource } from "./CsvIterableSource";

function file(name: string, text: string): File {
  return new File([text], name);
}

function topics(...names: string[]) {
  return new Map(names.map((topic) => [topic, { topic }]));
}

async function collect(
  source: CsvIterableSource,
  args: Parameters<CsvIterableSource["messageIterator"]>[0],
): Promise<MessageEvent[]> {
  const events: MessageEvent[] = [];
  for await (const result of source.messageIterator(args)) {
    if (result.type === "message-event") {
      events.push(result.msgEvent);
    }
  }
  return events;
}

describe("CsvIterableSource", () => {
  it("reads one topic per file with typed fields and a detected time column", async () => {
    const source = new CsvIterableSource([
      file("drive log.csv", "speed,time_ms,mode\n1.5,1000,a\n2.5,2000,b\n,3000,c\n"),
    ]);
    const init = await source.initialize();

    expect(init.topics).toEqual([{ name: "/drive_log", schemaName: "csv/drive_log" }]);
    expect(init.datatypes.get("csv/drive_log")?.definitions).toEqual([
      { name: "speed", type: "float64" },
      { name: "time_ms", type: "float64" },
      { name: "mode", type: "string" },
    ]);
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 3, nsec: 0 });
    expect(init.topicStats.get("/drive_log")?.numMessages).toBe(3);
    expect(init.alerts).toEqual([]);

    const events = await collect(source, { topics: topics("/drive_log") });
    expect(events.map((e) => e.message)).toEqual([
      { speed: 1.5, time_ms: 1000, mode: "a" },
      { speed: 2.5, time_ms: 2000, mode: "b" },
      { speed: NaN, time_ms: 3000, mode: "c" },
    ]);
    expect(events[1]!.receiveTime).toEqual({ sec: 2, nsec: 0 });
  });

  it("limits iteration to the requested range and backfills the last row before a time", async () => {
    // Enough rows to span several seek index entries
    const lines = ["t,v"];
    for (let i = 0; i < 5000; i++) {
      lines.push(`${i},${i * 2}`);
    }
    const source = new CsvIterableSource([file("big.csv", lines.join("\n"))]);
    await source.initialize();

    const events = await collect(source, {
      topics: topics("/big"),
      start: { sec: 3000, nsec: 0 },
      end: { sec: 3002, nsec: 0 },
    });
    expect(events.map((e) => (e.message as { v: number }).v)).toEqual([6000, 6002, 6004]);

    const backfill = await source.getBackfillMessages({
      topics: topics("/big"),
      time: { sec: 4100, nsec: 500 },
    });
    expect(backfill.map((e) => e.message)).toEqual([{ t: 4100, v: 8200 }]);
  });

  it("reads every row when many rows share a timestamp across index entries", async () => {
    const lines = ["time,v"];
    for (let i = 0; i < 5000; i++) {
      lines.push(`${i < 4000 ? 0 : 1},${i}`);
    }
    const source = new CsvIterableSource([file("same.csv", lines.join("\n"))]);
    await source.initialize();

    const all = await collect(source, { topics: topics("/same") });
    expect(all).toHaveLength(5000);
    const fromOne = await collect(source, { topics: topics("/same"), start: { sec: 1, nsec: 0 } });
    expect(fromOne).toHaveLength(1000);
    expect((fromOne[0]!.message as { v: number }).v).toBe(4000);
  });

  it("seeks exactly to times too large for a double", async () => {
    // A double rounds this down by about 1 µs; approximate index times would skip rows on a seek
    const lines = ["time_ns,v"];
    for (let i = 0; i < 5000; i++) {
      lines.push(`10000000000000001023,${i}`);
    }
    const source = new CsvIterableSource([file("big_ns.csv", lines.join("\n"))]);
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: 10000000000, nsec: 1023 });

    const events = await collect(source, { topics: topics("/big_ns"), start: init.start });
    expect(events).toHaveLength(5000);
    const backfill = await source.getBackfillMessages({
      topics: topics("/big_ns"),
      time: init.start,
    });
    expect(backfill.map((e) => (e.message as { v: number }).v)).toEqual([4999]);
  });

  it("rejects a time column that decreases only at nanosecond precision", async () => {
    // All three are the same double, but the last one is earlier than the second
    const source = new CsvIterableSource([
      file(
        "ns.csv",
        "time_ns,v\n1700000000000000000,1\n1700000000000000002,2\n1700000000000000001,3\n",
      ),
    ]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([
      expect.objectContaining({ message: "ns.csv: no time column found" }),
    ]);
  });

  it("rejects a decrease hidden by mixing decimal and exponent notation", async () => {
    // Both are the same double; 1e18 ns is 1 ns before 1000000000000000001 ns
    const source = new CsvIterableSource([
      file("mixed.csv", "time_ns\n1000000000000000001\n1e18\n"),
    ]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([
      expect.objectContaining({ message: "mixed.csv: no time column found" }),
    ]);
  });

  it("keeps exact nanosecond times of an increasing column", async () => {
    const source = new CsvIterableSource([
      file("ns.csv", "time_ns,v\n1700000000000000001,1\n1700000000000000002,2\n"),
    ]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([]);
    expect(init.start).toEqual({ sec: 1700000000, nsec: 1 });
    expect(init.end).toEqual({ sec: 1700000000, nsec: 2 });
  });

  it("accepts the same instant written in exponent notation", async () => {
    const source = new CsvIterableSource([
      file(
        "exp.csv",
        "time_ns,v\n1700000000000000000,1e300\n1.7e18,1e300\n1700000000000000000,1\n",
      ),
    ]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([]);
    expect(init.topicStats.get("/exp")?.numMessages).toBe(3);
    expect(init.end).toEqual({ sec: 1700000000, nsec: 0 });
  });

  it("does not use a column of infinite values as the time", async () => {
    const source = new CsvIterableSource([file("inf.csv", "time,v\nInfinity,a\nInfinity,b\n")]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([
      expect.objectContaining({ message: "inf.csv: no time column found" }),
    ]);
  });

  it("merges several files in time order", async () => {
    const source = new CsvIterableSource([
      file("a.csv", "time,x\n1,1\n3,3\n"),
      file("b.csv", "time,y\n2,2\n4,4\n"),
    ]);
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: 1, nsec: 0 });
    expect(init.end).toEqual({ sec: 4, nsec: 0 });

    const events = await collect(source, { topics: topics("/a", "/b") });
    expect(events.map((e) => [e.topic, e.receiveTime.sec])).toEqual([
      ["/a", 1],
      ["/b", 2],
      ["/a", 3],
      ["/b", 4],
    ]);
  });

  it("parses date-time strings, semicolons and decimal commas", async () => {
    const source = new CsvIterableSource([
      file("eu.csv", "Zeit;Wert\n2024-01-01T00:00:00Z;1,5\n2024-01-01T00:00:01Z;2,5\n"),
    ]);
    const init = await source.initialize();
    expect(init.start).toEqual({ sec: Date.UTC(2024, 0, 1) / 1000, nsec: 0 });
    const events = await collect(source, { topics: topics("/eu") });
    expect(events.map((e) => e.message)).toEqual([
      { Zeit: "2024-01-01T00:00:00Z", Wert: 1.5 },
      { Zeit: "2024-01-01T00:00:01Z", Wert: 2.5 },
    ]);
  });

  it("falls back to row order with a warning when no column can be the time", async () => {
    const source = new CsvIterableSource([file("noTime.csv", "name,v\nb,3\na,1\n")]);
    const init = await source.initialize();
    expect(init.alerts).toEqual([
      expect.objectContaining({ severity: "warn", message: "noTime.csv: no time column found" }),
    ]);
    const events = await collect(source, { topics: topics("/noTime") });
    expect(events.map((e) => e.receiveTime.sec)).toEqual([0, 1]);
  });

  it("treats a header of numbers as data", async () => {
    const source = new CsvIterableSource([file("raw.csv", "1,10\n2,20\n")]);
    const init = await source.initialize();
    expect(init.topicStats.get("/raw")?.numMessages).toBe(2);
    const events = await collect(source, { topics: topics("/raw") });
    expect(events.map((e) => e.message)).toEqual([
      { column_1: 1, column_2: 10 },
      { column_1: 2, column_2: 20 },
    ]);
  });
});

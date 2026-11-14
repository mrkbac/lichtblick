// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import {
  cellToNs,
  detectDelimiter,
  isTimeName,
  numericTimeFormat,
  parseDateMs,
  parseNumber,
  readRows,
  splitRow,
  toFieldNames,
} from "./csv";

async function allRows(text: string, start = 0) {
  const rows = [];
  for await (const batch of readRows(new Blob([text]), start)) {
    rows.push(...batch);
  }
  return rows;
}

describe("readRows", () => {
  it("splits on LF outside quotes, drops CR and empty rows, keeps byte offsets", async () => {
    // "ü" is two bytes in UTF-8, so the first row is 6 bytes with its CRLF
    const text = 'ü,b\r\n"x\ny",1\n\nc,2';
    expect(await allRows(text)).toEqual([
      { offset: 0, line: "ü,b" },
      { offset: 6, line: '"x\ny",1' },
      { offset: 15, line: "c,2" },
    ]);
  });

  it("joins a quoted row that spans the read chunk boundary", async () => {
    const chunkSize = 4 * 1024 * 1024;
    const first = "a".repeat(chunkSize - 3);
    // The quote opens right before the boundary and the quoted LF lands after it
    const text = `${first}\n"x\ny",1\nz`;
    const rows = await allRows(text);
    expect(rows.map((r) => r.line.length)).toEqual([first.length, 7, 1]);
    expect(rows[1]).toEqual({ offset: chunkSize - 2, line: '"x\ny",1' });
    expect(rows[2]).toEqual({ offset: chunkSize + 6, line: "z" });
  });

  it("starts reading at a byte offset", async () => {
    expect(await allRows("a\nbb\nccc\n", 2)).toEqual([
      { offset: 2, line: "bb" },
      { offset: 5, line: "ccc" },
    ]);
  });
});

describe("splitRow", () => {
  it("handles quoted delimiters and escaped quotes", () => {
    expect(splitRow('1,"a,b","say ""hi""",', ",")).toEqual(["1", "a,b", 'say "hi"', ""]);
  });
});

describe("detectDelimiter", () => {
  it("picks the most frequent delimiter, tab for .tsv", () => {
    expect(detectDelimiter("a;b;c", "x.csv")).toBe(";");
    expect(detectDelimiter("a,b", "x.csv")).toBe(",");
    expect(detectDelimiter("a,b", "x.tsv")).toBe("\t");
  });
});

describe("parseNumber / parseDateMs", () => {
  it("parses numbers, empty as NaN, decimal comma for semicolon files", () => {
    expect(parseNumber(" 1.5 ", ",")).toBe(1.5);
    expect(parseNumber("", ",")).toBeNaN();
    expect(parseNumber("1,5", ";")).toBe(1.5);
    expect(parseNumber("abc", ",")).toBeNaN();
  });

  it("only accepts date-time strings as dates", () => {
    expect(parseDateMs("2024-01-31T12:00:00Z")).toBe(Date.UTC(2024, 0, 31, 12));
    expect(parseDateMs("2024")).toBeNaN();
  });
});

describe("toFieldNames", () => {
  it("makes names path-safe and unique", () => {
    expect(toFieldNames(["Time (s)", "speed", "speed", "1st", ""])).toEqual([
      "Time_s",
      "speed",
      "speed_2",
      "_1st",
      "column_5",
    ]);
  });
});

describe("time columns", () => {
  it("recognizes time-like names", () => {
    expect(isTimeName("timestamp_ns")).toBe(true);
    expect(isTimeName("Time (s)")).toBe(true);
    expect(isTimeName("speed")).toBe(false);
  });

  it("takes the unit from the header, else from the magnitude", () => {
    expect(numericTimeFormat("time_ms", 5)).toEqual({ type: "number", nsPerUnit: 1_000_000n });
    expect(numericTimeFormat("t", 1.7e18)).toEqual({ type: "number", nsPerUnit: 1n });
    expect(numericTimeFormat("t", 1.7e15)).toEqual({ type: "number", nsPerUnit: 1_000n });
    expect(numericTimeFormat("t", 1.7e12)).toEqual({ type: "number", nsPerUnit: 1_000_000n });
    expect(numericTimeFormat("t", 1.7e9)).toEqual({ type: "number", nsPerUnit: 1_000_000_000n });
  });

  it("converts cells to exact nanoseconds", () => {
    const sec = { type: "number", nsPerUnit: 1_000_000_000n } as const;
    expect(cellToNs("1700000000.123456789", sec, ",")).toBe(1700000000123456789n);
    expect(cellToNs("1,5", sec, ";")).toBe(1_500_000_000n);
    expect(cellToNs("1700000000123456789", { type: "number", nsPerUnit: 1n }, ",")).toBe(
      1700000000123456789n,
    );
    expect(cellToNs("1e3", sec, ",")).toBe(1_000_000_000_000n);
    expect(cellToNs("1970-01-01T00:00:01.5Z", { type: "date" }, ",")).toBe(1_500_000_000n);
  });
});

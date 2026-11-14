// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// Pure helpers for reading delimited text files (CSV/TSV): row splitting, cell parsing and time
// column handling. No DOM or player dependencies so they are easy to test.

const QUOTE = 0x22;
const LF = 0x0a;
const CHUNK_SIZE = 4 * 1024 * 1024;

export type Row = { offset: number; line: string };

/**
 * Reads the rows of `blob` starting at byte `start`, in batches (one batch per chunk read).
 *
 * Rows are split on LF bytes outside of double quotes. Scanning bytes rather than decoded text keeps
 * byte offsets exact (needed for seeking), and is safe for UTF-8 since quote and LF bytes never
 * occur inside a multi-byte sequence. Trailing CR and empty rows are dropped.
 */
export async function* readRows(blob: Blob, start = 0): AsyncGenerator<Row[]> {
  const decoder = new TextDecoder();
  let carry = new Uint8Array(0);
  let carryOffset = start;
  let inQuote = false;

  const toRow = (buf: Uint8Array, from: number, to: number): Row | undefined => {
    let end = to;
    if (end > from && buf[end - 1] === 0x0d) {
      end--;
    }
    return end > from
      ? { offset: carryOffset + from, line: decoder.decode(buf.subarray(from, end)) }
      : undefined;
  };

  for (let pos = start; pos < blob.size; pos += CHUNK_SIZE) {
    const chunk = new Uint8Array(await blob.slice(pos, pos + CHUNK_SIZE).arrayBuffer());
    let buf = chunk;
    if (carry.length > 0) {
      buf = new Uint8Array(carry.length + chunk.length);
      buf.set(carry);
      buf.set(chunk, carry.length);
    }

    const rows: Row[] = [];
    let rowStart = 0;
    // The carried bytes were already scanned, so `inQuote` is the state after them
    for (let i = carry.length; i < buf.length; i++) {
      const byte = buf[i];
      if (byte === QUOTE) {
        inQuote = !inQuote;
      } else if (byte === LF && !inQuote) {
        const row = toRow(buf, rowStart, i);
        if (row) {
          rows.push(row);
        }
        rowStart = i + 1;
      }
    }
    carryOffset += rowStart;
    carry = buf.slice(rowStart);
    if (rows.length > 0) {
      yield rows;
    }
  }

  const last = toRow(carry, 0, carry.length);
  if (last) {
    yield [last];
  }
}

/** Splits one row into cells. Handles RFC 4180 quoting ("a,b" and "" as an escaped quote). */
export function splitRow(line: string, delimiter: string): string[] {
  if (!line.includes('"')) {
    return line.split(delimiter);
  }

  const cells: string[] = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Picks the delimiter that occurs most often in the header line (tab for .tsv files). */
export function detectDelimiter(header: string, fileName: string): string {
  if (fileName.toLowerCase().endsWith(".tsv")) {
    return "\t";
  }
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t", "|"]) {
    const count = splitRow(header, candidate).length;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Normalizes a numeric cell for Number(). Semicolon-separated files (common in European exports)
 * use a decimal comma, so there "1,5" means 1.5.
 */
function numericText(cell: string, delimiter: string): string {
  const trimmed = cell.trim();
  return delimiter === ";" ? trimmed.replace(",", ".") : trimmed;
}

/** Parses a numeric cell of a file with the given delimiter. Empty cells are NaN. */
export function parseNumber(cell: string, delimiter: string): number {
  const text = numericText(cell, delimiter);
  return text === "" ? NaN : Number(text);
}

// Date-time strings like 2024-01-31T12:00:00Z or 2024-01-31 12:00:00.123. A plain number is not a
// date even though Date.parse accepts some.
const DATE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

export function parseDateMs(cell: string): number {
  const trimmed = cell.trim();
  return DATE_RE.test(trimmed) ? Date.parse(trimmed) : NaN;
}

/** Turns header cells into unique message field names usable in message paths. */
export function toFieldNames(header: readonly string[]): string[] {
  const used = new Set<string>();
  return header.map((raw, idx) => {
    let name = raw
      .trim()
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (name === "") {
      name = `column_${idx + 1}`;
    } else if (/^\d/.test(name)) {
      name = `_${name}`;
    }
    let unique = name;
    for (let n = 2; used.has(unique); n++) {
      unique = `${name}_${n}`;
    }
    used.add(unique);
    return unique;
  });
}

export type TimeFormat = { type: "date" } | { type: "number"; nsPerUnit: bigint };

const TIME_NAME_RE = /^(time|timestamp|stamp|ts|t|datetime|date|header_stamp)$/i;
const UNIT_SUFFIX_RE = /[_\s([]*(ns|us|µs|ms|s|sec|secs|seconds)[)\]]?$/i;
const NS_PER_UNIT: Record<string, bigint> = {
  ns: 1n,
  us: 1_000n,
  µs: 1_000n,
  ms: 1_000_000n,
  s: 1_000_000_000n,
  sec: 1_000_000_000n,
  secs: 1_000_000_000n,
  seconds: 1_000_000_000n,
};

/** Whether a header looks like a time column, e.g. "time", "timestamp_ns", "Time (s)". */
export function isTimeName(header: string): boolean {
  const base = header.trim().replace(UNIT_SUFFIX_RE, "");
  return TIME_NAME_RE.test(base) || /time|stamp/i.test(base);
}

/**
 * Picks the unit of a numeric time column: from a unit in the header ("_ms", "(s)") if present,
 * otherwise from the magnitude of the first value assuming a Unix epoch time.
 */
export function numericTimeFormat(header: string, firstValue: number): TimeFormat {
  const unit = UNIT_SUFFIX_RE.exec(header.trim())?.[1]?.toLowerCase();
  if (unit != undefined && NS_PER_UNIT[unit] != undefined) {
    return { type: "number", nsPerUnit: NS_PER_UNIT[unit] };
  }
  const abs = Math.abs(firstValue);
  const nsPerUnit =
    abs >= 1e17 ? 1n : abs >= 1e14 ? 1_000n : abs >= 1e11 ? 1_000_000n : 1_000_000_000n;
  return { type: "number", nsPerUnit };
}

/** Converts a time cell to nanoseconds, exactly for plain decimal numbers. */
export function cellToNs(cell: string, format: TimeFormat, delimiter: string): bigint {
  if (format.type === "date") {
    return BigInt(Date.parse(cell.trim())) * 1_000_000n;
  }
  const text = numericText(cell, delimiter);
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    // Exponent notation and the like: precision of a double is all we can do
    return BigInt(Math.round(Number(text) * Number(format.nsPerUnit)));
  }
  const [, sign, intPart = "", fracPart = ""] = match;
  const digits = format.nsPerUnit.toString().length - 1; // 10^digits ns per unit
  const frac = fracPart.slice(0, digits).padEnd(digits, "0");
  // BigInt("") is 0n, so ".5" and "5." work too
  const ns = BigInt(intPart) * format.nsPerUnit + BigInt(frac);
  return sign === "-" ? -ns : ns;
}

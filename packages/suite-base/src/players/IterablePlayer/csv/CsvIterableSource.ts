// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite";
import { PlayerAlert, Topic, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import {
  TimeFormat,
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
import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "../IIterableSource";

// One seek point per this many rows: a 10M row file keeps ~10k index entries
const ROWS_PER_INDEX = 1024;
const NS_PER_SEC = 1_000_000_000n;
// Any fixed unit gives the same order; seconds keeps every digit of the value
const EXACT_ORDER: TimeFormat = { type: "number", nsPerUnit: NS_PER_SEC };

type IndexEntry = { offset: number; row: number; timeNs: bigint };

/**
 * One CSV/TSV file as one topic. `open()` makes a single pass over the file to infer column types,
 * pick the time column and build a sparse seek index; reads then seek and parse only what they need,
 * so memory stays flat regardless of file size.
 */
class CsvFile {
  public alerts: PlayerAlert[] = [];
  public rowCount = 0;
  public startNs = 0n;
  public endNs = 0n;
  public fields: { name: string; numeric: boolean }[] = [];

  #index: IndexEntry[] = [];
  #delimiter = ",";
  #timeColumn: number | undefined;
  #timeFormat: TimeFormat = { type: "number", nsPerUnit: NS_PER_SEC };

  public constructor(
    public readonly file: File,
    public readonly topic: string,
    public readonly schemaName: string,
  ) {}

  public async open(): Promise<void> {
    let header: string[] | undefined;
    let numeric: boolean[] = [];
    let timeOk: boolean[] = [];
    let isDate: boolean[] = [];
    let lastTime: number[] = [];
    let lastTimeCell: string[] = [];
    let firstCells: string[] = [];
    let lastCells: string[] = [];
    // Cells of each index entry's first row (about 1/1024 of the file), for exact entry times
    const entryCells: string[][] = [];
    let row = 0;

    for await (const rows of readRows(this.file)) {
      for (const { offset, line } of rows) {
        if (!header) {
          this.#delimiter = detectDelimiter(line, this.file.name);
          const cells = splitRow(line, this.#delimiter);
          const allNumeric = cells.every((c) => !isNaN(parseNumber(c, this.#delimiter)));
          header = allNumeric ? cells.map((_, idx) => `column_${idx + 1}`) : cells;
          numeric = header.map(() => true);
          timeOk = header.map(() => true);
          isDate = header.map(() => false);
          lastTime = header.map(() => -Infinity);
          lastTimeCell = header.map(() => "");
          if (!allNumeric) {
            continue;
          }
        }

        const cells = splitRow(line, this.#delimiter);
        if (row % ROWS_PER_INDEX === 0) {
          this.#index.push({ offset, row, timeNs: 0n });
          entryCells.push(cells);
        }
        if (row === 0) {
          firstCells = cells;
        }
        lastCells = cells;

        for (let col = 0; col < header.length; col++) {
          const cell = cells[col] ?? "";
          if (numeric[col] === true && cell.trim() !== "") {
            numeric[col] = !isNaN(parseNumber(cell, this.#delimiter));
          }
          if (timeOk[col] !== true) {
            continue;
          }
          if (row === 0) {
            isDate[col] = !isNaN(parseDateMs(cell));
          }
          const value =
            isDate[col] === true ? parseDateMs(cell) : parseNumber(cell, this.#delimiter);
          // Time must be present, finite, non-negative and non-decreasing to drive playback.
          // Doubles round long values (e.g. epoch ns), so equal doubles are compared exactly.
          if (
            !Number.isFinite(value) ||
            value < 0 ||
            value < lastTime[col]! ||
            (value === lastTime[col] &&
              isDate[col] !== true &&
              cellToNs(cell, EXACT_ORDER, this.#delimiter) <
                cellToNs(lastTimeCell[col]!, EXACT_ORDER, this.#delimiter))
          ) {
            timeOk[col] = false;
          } else {
            lastTime[col] = value;
            lastTimeCell[col] = cell;
          }
        }
        row++;
      }
    }

    this.rowCount = row;
    const names = header ?? [];
    const fieldNames = toFieldNames(names);
    this.fields = fieldNames.map((name, col) => ({
      name,
      numeric: numeric[col] === true && isDate[col] !== true,
    }));

    if (row === 0) {
      this.alerts.push({ severity: "warn", message: `${this.file.name}: no data rows found` });
      return;
    }

    const usable = (col: number) => timeOk[col] === true;
    const named = names.findIndex((name, col) => usable(col) && isTimeName(name));
    this.#timeColumn = named !== -1 ? named : usable(0) ? 0 : undefined;

    const col = this.#timeColumn;
    if (col == undefined) {
      this.alerts.push({
        severity: "warn",
        message: `${this.file.name}: no time column found`,
        tip: "Rows are spaced 1 s apart in file order. Add an increasing column named e.g. 'time' or 'timestamp' to use real times.",
      });
      for (const entry of this.#index) {
        entry.timeNs = BigInt(entry.row) * NS_PER_SEC;
      }
      this.endNs = BigInt(row - 1) * NS_PER_SEC;
      return;
    }

    this.#timeFormat =
      isDate[col] === true
        ? { type: "date" }
        : numericTimeFormat(names[col]!, parseNumber(firstCells[col]!, this.#delimiter));
    this.#index.forEach((entry, idx) => {
      entry.timeNs = this.#cellTime(entryCells[idx]!, entry.row);
    });
    this.startNs = this.#cellTime(firstCells, 0);
    this.endNs = this.#cellTime(lastCells, row - 1);
  }

  /** Yields batches of message events with startNs <= time <= endNs, in file order. */
  public async *events(startNs: bigint, endNs: bigint): AsyncGenerator<MessageEvent[]> {
    const entry = this.#seek(startNs);
    if (!entry) {
      return;
    }
    let row = entry.row;
    for await (const rows of readRows(this.file, entry.offset)) {
      const batch: MessageEvent[] = [];
      for (const { line } of rows) {
        const cells = splitRow(line, this.#delimiter);
        const timeNs = this.#cellTime(cells, row++);
        if (timeNs > endNs) {
          if (batch.length > 0) {
            yield batch;
          }
          return;
        }
        if (timeNs >= startNs) {
          batch.push(this.#event(cells, timeNs, line.length));
        }
      }
      if (batch.length > 0) {
        yield batch;
      }
    }
  }

  /** The last row at or before `timeNs`. */
  public async backfill(timeNs: bigint): Promise<MessageEvent | undefined> {
    const entry = this.#seek(timeNs);
    if (!entry) {
      return undefined;
    }
    let row = entry.row;
    let last: { cells: string[]; timeNs: bigint; size: number } | undefined;
    for await (const rows of readRows(this.file, entry.offset)) {
      for (const { line } of rows) {
        const cells = splitRow(line, this.#delimiter);
        const rowNs = this.#cellTime(cells, row++);
        if (rowNs > timeNs) {
          return last && this.#event(last.cells, last.timeNs, last.size);
        }
        last = { cells, timeNs: rowNs, size: line.length };
      }
    }
    return last && this.#event(last.cells, last.timeNs, last.size);
  }

  /**
   * The entry to start reading at so no row at or after `timeNs` is skipped: the one before the
   * first entry at or after `timeNs`. Using the first such entry, not the last, matters when many
   * rows share a timestamp. Entry times are exact, so no row before the result can be at `timeNs`.
   */
  #seek(timeNs: bigint): IndexEntry | undefined {
    let lo = 0;
    let hi = this.#index.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.#index[mid]!.timeNs < timeNs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return this.#index[Math.max(0, lo - 1)];
  }

  #cellTime(cells: readonly string[], row: number): bigint {
    if (this.#timeColumn == undefined) {
      return BigInt(row) * NS_PER_SEC;
    }
    return cellToNs(cells[this.#timeColumn] ?? "", this.#timeFormat, this.#delimiter);
  }

  #event(cells: readonly string[], timeNs: bigint, sizeInBytes: number): MessageEvent {
    const message: Record<string, number | string> = {};
    this.fields.forEach(({ name, numeric }, col) => {
      const cell = cells[col] ?? "";
      message[name] = numeric ? parseNumber(cell, this.#delimiter) : cell;
    });
    return {
      topic: this.topic,
      schemaName: this.schemaName,
      receiveTime: fromNanoSec(timeNs),
      message,
      sizeInBytes,
    };
  }
}

/** Topic name for a file: "/" + the file name without extension, made path-safe and unique. */
function topicNames(files: readonly File[]): string[] {
  const stems = files.map((file) => file.name.replace(/\.[^.]*$/, ""));
  return toFieldNames(stems).map((name) => `/${name}`);
}

/**
 * Reads one or more CSV/TSV files, one topic per file, merged in time order. Each row is a message
 * whose fields are the columns: numeric columns as float64, everything else as string.
 */
export class CsvIterableSource implements IIterableSource {
  #files: CsvFile[];

  public constructor(files: readonly File[]) {
    const names = topicNames(files);
    this.#files = files.map((file, idx) => new CsvFile(file, names[idx]!, `csv${names[idx]!}`));
  }

  public async initialize(): Promise<Initialization> {
    await Promise.all(
      this.#files.map(async (file) => {
        await file.open();
      }),
    );

    const withRows = this.#files.filter((file) => file.rowCount > 0);
    const startNs = withRows.length > 0 ? min(withRows.map((file) => file.startNs)) : 0n;
    const endNs = withRows.length > 0 ? max(withRows.map((file) => file.endNs)) : 0n;

    const topics: Topic[] = [];
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    for (const file of this.#files) {
      topics.push({ name: file.topic, schemaName: file.schemaName });
      topicStats.set(file.topic, {
        numMessages: file.rowCount,
        firstMessageTime: fromNanoSec(file.startNs),
        lastMessageTime: fromNanoSec(file.endNs),
      });
      datatypes.set(file.schemaName, {
        definitions: file.fields.map(({ name, numeric }) => ({
          name,
          type: numeric ? "float64" : "string",
        })),
      });
    }

    return {
      start: fromNanoSec(startNs),
      end: fromNanoSec(endNs),
      topics,
      topicStats,
      datatypes,
      profile: undefined,
      alerts: this.#files.flatMap((file) => file.alerts),
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    const startNs = args.start ? toNanoSec(args.start) : 0n;
    const endNs = args.end ? toNanoSec(args.end) : BigInt(Number.MAX_SAFE_INTEGER) * NS_PER_SEC;
    const iterators = this.#files
      .filter((file) => args.topics.has(file.topic))
      .map((file) => file.events(startNs, endNs));

    // k-way merge of the per-file batches by receive time (k = number of selected files, small)
    const heads: {
      iterator: AsyncGenerator<MessageEvent[]>;
      batch: MessageEvent[];
      idx: number;
    }[] = [];
    try {
      for (const iterator of iterators) {
        const next = await iterator.next();
        if (next.done !== true) {
          heads.push({ iterator, batch: next.value, idx: 0 });
        }
      }
      while (heads.length > 0) {
        let best = heads[0]!;
        for (const head of heads) {
          if (compare(head.batch[head.idx]!.receiveTime, best.batch[best.idx]!.receiveTime) < 0) {
            best = head;
          }
        }
        yield { type: "message-event", msgEvent: best.batch[best.idx]! };
        if (++best.idx === best.batch.length) {
          const next = await best.iterator.next();
          if (next.done === true) {
            heads.splice(heads.indexOf(best), 1);
          } else {
            best.batch = next.value;
            best.idx = 0;
          }
        }
      }
    } finally {
      await Promise.all(iterators.map(async (iterator) => await iterator.return(undefined)));
    }
  }

  public async getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    const timeNs = toNanoSec(args.time);
    const events = await Promise.all(
      this.#files
        .filter((file) => args.topics.has(file.topic))
        .map(async (file) => await file.backfill(timeNs)),
    );
    return events.filter((event): event is MessageEvent => event != undefined);
  }
}

function min(values: bigint[]): bigint {
  return values.reduce((a, b) => (b < a ? b : a));
}

function max(values: bigint[]): bigint {
  return values.reduce((a, b) => (b > a ? b : a));
}

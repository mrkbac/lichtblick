// SPDX-License-Identifier: MPL-2.0

import { parseQosProfiles } from "@foxglove/rosbag2";
import type { MessageReadOptions, RawMessage, SqliteDb, TopicDefinition } from "@foxglove/rosbag2";
import { fromNanoSec, toNanoSec } from "@foxglove/rostime";
import type { Time } from "@foxglove/rostime";
import type { BindableValue } from "@sqlite.org/sqlite-wasm";
import { parse } from "yaml";

import { openSqliteFile } from "./SqliteFile";

type RowCursor = { timestamp: bigint; id?: bigint };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value != undefined && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class SqliteRosDb3 implements SqliteDb {
  readonly #file: File;
  #connection?: Awaited<ReturnType<typeof openSqliteFile>>;
  readonly #topics = new Map<bigint, TopicDefinition>();
  readonly #topicIds = new Map<string, bigint>();

  public constructor(file: File) {
    this.#file = file;
  }

  public async open(): Promise<void> {
    const connection = await openSqliteFile(this.#file);
    try {
      // Older ROS 2 bags do not have an offered QoS profiles column. Later columns are unused.
      for (const [id, name, type, serializationFormat, qos] of connection.db.selectArrays(
        "SELECT * FROM topics",
      )) {
        if (
          (typeof id !== "number" && typeof id !== "bigint") ||
          typeof name !== "string" ||
          typeof type !== "string" ||
          typeof serializationFormat !== "string"
        ) {
          throw new Error("Invalid ROS 2 topic definition");
        }
        const topicId = BigInt(id);
        this.#topics.set(topicId, {
          name,
          type,
          serializationFormat,
          offeredQosProfiles: parseQosProfiles(typeof qos === "string" ? qos : "[]"),
        });
        this.#topicIds.set(name, topicId);
      }
      this.#connection = connection;
    } catch (error) {
      connection.db.close();
      throw error;
    }
  }

  public async close(): Promise<void> {
    this.#connection?.db.close();
    this.#connection = undefined;
  }

  public async readTopics(): Promise<TopicDefinition[]> {
    return [...this.#topics.values()];
  }

  public async *readMessages(opts: MessageReadOptions): AsyncIterableIterator<RawMessage> {
    const { db, capi } = this.#opened();
    const where: string[] = [];
    const bind: BindableValue[] = [];
    if (opts.startTime != undefined) {
      where.push("timestamp >= ?");
      bind.push(toNanoSec(opts.startTime));
    }
    if (opts.endTime != undefined) {
      where.push("timestamp < ?");
      bind.push(toNanoSec(opts.endTime));
    }
    if (opts.topics != undefined) {
      const ids = opts.topics
        .map((name) => this.#topicIds.get(name))
        .filter((id) => id != undefined);
      if (ids.length === 0) {
        return;
      }
      where.push(`topic_id IN (${ids.map(() => "?").join(",")})`);
      bind.push(...ids);
    }
    const stmt = db.prepare(
      `SELECT topic_id, timestamp, data FROM messages
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY timestamp, id`,
    );
    try {
      stmt.bind(bind);
      while (stmt.step()) {
        const topicId = capi.sqlite3_column_int64(stmt, 0);
        const topic = this.#topics.get(topicId);
        if (!topic) {
          throw new Error(`Cannot find topic_id ${topicId} in ${this.#topics.size} topics`);
        }
        yield {
          topic,
          timestamp: fromNanoSec(capi.sqlite3_column_int64(stmt, 1)),
          data: stmt.getBlob(2)!,
        };
      }
    } finally {
      stmt.finalize();
    }
  }

  public async timeRange(): Promise<[Time, Time]> {
    const { db } = this.#opened();
    // Separate subqueries let SQLite find both bounds using timestamp_idx without a full scan.
    const [min, max] = db.selectArray(
      "SELECT (SELECT min(timestamp) FROM messages), (SELECT max(timestamp) FROM messages)",
    ) as [bigint | number | null, bigint | number | null];
    return [fromNanoSec(BigInt(min ?? 0)), fromNanoSec(BigInt(max ?? 0))];
  }

  /** Accept per-file metadata only for single-file bags with matching message bounds. */
  public async embeddedMessageCounts(): Promise<Map<string, number> | undefined> {
    const { db } = this.#opened();
    let metadata: Record<string, unknown> | undefined;
    let firstId: string | undefined;
    let lastId: string | undefined;
    try {
      // Consecutive IDs catch stale append counts even when the recording time bounds did not move.
      const [text, first, last] =
        db.selectArray(
          `SELECT metadata, CAST((SELECT min(id) FROM messages) AS TEXT),
           CAST((SELECT max(id) FROM messages) AS TEXT)
         FROM metadata ORDER BY id DESC LIMIT 1`,
        ) ?? [];
      if (typeof text !== "string") {
        return undefined;
      }
      firstId = typeof first === "string" ? first : undefined;
      lastId = typeof last === "string" ? last : undefined;
      metadata = asRecord(parse(text, { intAsBigInt: true }));
    } catch {
      // Older recordings have no metadata table. Invalid metadata also needs a scan.
      return undefined;
    }
    const paths = metadata?.relative_file_paths;
    const entries = metadata?.topics_with_message_count;
    const expected = metadata?.message_count;
    if (
      metadata?.storage_identifier !== "sqlite3" ||
      !Array.isArray(paths) ||
      paths.length !== 1 ||
      typeof paths[0] !== "string" ||
      !Array.isArray(entries) ||
      typeof expected !== "bigint" ||
      expected <= 0n ||
      expected > BigInt(Number.MAX_SAFE_INTEGER) ||
      firstId !== "1" ||
      lastId !== expected.toString()
    ) {
      return undefined;
    }
    const [start, end] = await this.timeRange();
    if (
      asRecord(metadata.starting_time)?.nanoseconds_since_epoch !== toNanoSec(start) ||
      asRecord(metadata.duration)?.nanoseconds !== toNanoSec(end) - toNanoSec(start)
    ) {
      return undefined;
    }
    const counts = new Map<string, number>();
    let total = 0n;
    for (const entry of entries as unknown[]) {
      const item = asRecord(entry);
      const name = asRecord(item?.topic_metadata)?.name;
      const count = item?.message_count;
      if (
        typeof name !== "string" ||
        !this.#topicIds.has(name) ||
        counts.has(name) ||
        typeof count !== "bigint" ||
        count < 0n ||
        count > expected
      ) {
        return undefined;
      }
      counts.set(name, Number(count));
      total += count;
    }
    return total === expected ? counts : undefined;
  }

  public async messageCounts(): Promise<Map<string, number>> {
    const { db } = this.#opened();
    const rows = db.selectArrays(
      `SELECT topics.name, count(*) FROM messages
       INNER JOIN topics ON messages.topic_id = topics.id
       GROUP BY topics.id`,
    ) as [string, number | bigint][];
    return new Map(rows.map(([topic, count]) => [topic, Number(count)]));
  }

  /** Scan a bounded page of any topic before fetching the payloads for the requested topics. */
  public backfillPage(
    from: RowCursor,
    topics: string[],
    limit: number,
  ): { found: RawMessage[]; next: RowCursor | undefined } {
    const { db, capi } = this.#opened();
    const wanted = new Set(topics.map((name) => this.#topicIds.get(name)));
    const matches = new Map<bigint, { id: bigint; timestamp: bigint }>();
    let oldest: RowCursor | undefined;
    let rows = 0;
    const scan = db.prepare(
      `SELECT id, topic_id, timestamp FROM messages
       WHERE timestamp <= ?${from.id == undefined ? "" : " AND (timestamp < ? OR id < ?)"}
       ORDER BY timestamp DESC, id DESC LIMIT ?`,
    );
    try {
      scan.bind(
        from.id == undefined
          ? [from.timestamp, limit]
          : [from.timestamp, from.timestamp, from.id, limit],
      );
      while (scan.step()) {
        const id = capi.sqlite3_column_int64(scan, 0);
        const topicId = capi.sqlite3_column_int64(scan, 1);
        const timestamp = capi.sqlite3_column_int64(scan, 2);
        oldest = { id, timestamp };
        rows++;
        if (wanted.has(topicId) && !matches.has(topicId)) {
          matches.set(topicId, { id, timestamp });
        }
      }
    } finally {
      scan.finalize();
    }

    const found: RawMessage[] = [];
    if (matches.size > 0) {
      const read = db.prepare("SELECT data FROM messages WHERE id = ?");
      try {
        for (const [topicId, { id, timestamp }] of matches) {
          read.bind([id]);
          if (read.step()) {
            found.push({
              topic: this.#topics.get(topicId)!,
              timestamp: fromNanoSec(timestamp),
              data: read.getBlob(0)!,
            });
          }
          read.reset();
        }
      } finally {
        read.finalize();
      }
    }
    return { found, next: rows === limit ? oldest : undefined };
  }

  #opened(): Awaited<ReturnType<typeof openSqliteFile>> {
    if (!this.#connection) {
      throw new Error("Call open() before reading the database");
    }
    return this.#connection;
  }
}

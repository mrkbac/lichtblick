// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageDefinition } from "@foxglove/message-definition";
import { ROS2_TO_DEFINITIONS, Rosbag2, SqliteSqljs } from "@foxglove/rosbag2-web";
import { stringify } from "@foxglove/rosmsg";
import { Time, add as addTime, compare, toNanoSec } from "@foxglove/rostime";
import { SqlJsStatic } from "@foxglove/sql.js";
import { parse } from "yaml";

import { MessageEvent } from "@lichtblick/suite";
import { APP_CONFIG } from "@lichtblick/suite-base/constants/config";
import { PlayerAlert, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { basicDatatypes } from "@lichtblick/suite-base/util/basicDatatypes";

import {
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "../IIterableSource";
import { BlockCachedFile } from "./BlockCachedFile";

/** Rows of any topic a backfill page scans: bounds the synchronous SQLite work between yields */
const BACKFILL_PAGE_ROWS = 4096;

/** Lets the worker take a superseding seek's abort message: sql.js reads synchronously */
async function yieldToWorker(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function dataTypeToFullName(dataType: string): string {
  const parts = dataType.split("/");
  if (parts.length === 2) {
    return `${parts[0]!}/msg/${parts[1]!}`;
  }
  return dataType;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value != undefined && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The embedded metadata is only per-file when the bag has one file. */
async function embeddedCounts({
  SQL,
  file,
  db,
  names,
}: {
  SQL: SqlJsStatic;
  file: BlockCachedFile;
  db: SqliteSqljs;
  names: ReadonlySet<string>;
}): Promise<Map<string, number> | undefined> {
  // Use the same SQLite engine and block cache as the playback connection.
  const reader = new SQL.Database({ file });
  let metadata: Record<string, unknown> | undefined;
  let firstId: string | undefined;
  let lastId: string | undefined;
  try {
    // rosbag2's writer appends consecutive IDs. Endpoint lookups detect a stale count even
    // when an appended message was recorded at a time inside the file's existing time range.
    const [text, first, last] =
      reader.exec(`
      select metadata, cast((select min(id) from messages) as text),
        cast((select max(id) from messages) as text)
      from metadata order by id desc limit 1
    `)[0]?.values[0] ?? [];
    firstId = typeof first === "string" ? first : undefined;
    lastId = typeof last === "string" ? last : undefined;
    if (typeof text !== "string") {
      return undefined;
    }
    metadata = asRecord(parse(text, { intAsBigInt: true }));
  } catch {
    // Older files have no metadata table. Malformed or incomplete metadata also needs a scan.
    return undefined;
  } finally {
    reader.close();
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
  const [start, end] = await db.timeRange();
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
      !names.has(name) ||
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

export class RosDb3IterableSource implements ISerializedIterableSource {
  #files: File[];
  #bag?: Rosbag2;
  /** Each file and its topics that might have messages. */
  #dbs: {
    db: SqliteSqljs;
    topics: ReadonlySet<string>;
    emptyThrough: Map<string, bigint>;
  }[] = [];
  #start: Time = { sec: 0, nsec: 0 };
  #end: Time = { sec: 0, nsec: 0 };
  #textEncoder = new TextEncoder();

  public readonly sourceType = "serialized";

  public constructor(files: File[]) {
    this.#files = files;
  }

  public async initialize(): Promise<Initialization> {
    const res = await fetch(
      new URL("@foxglove/sql.js/dist/sql-wasm.wasm", import.meta.url).toString(),
    );
    const sqlWasm = await (await res.blob()).arrayBuffer();
    const SQL = await SqliteSqljs.Initialize({ wasmBinary: sqlWasm });

    const files = this.#files.map((file) => new BlockCachedFile(file));
    const dbs = files.map((file) => new SqliteSqljs(file));
    const bag = new Rosbag2(dbs);
    await bag.open();
    this.#bag = bag;

    const [start, end] = await this.#bag.timeRange();
    const topicDefs = await this.#bag.readTopics();
    // Per file, so a backfill skips files without the topics it looks for
    const messageCounts = new Map<string, number>();
    this.#dbs = [];
    for (const [i, db] of dbs.entries()) {
      const names = new Set((await db.readTopics()).map((topic) => topic.name));
      const metadataCounts = await embeddedCounts({ SQL, file: files[i]!, db, names });
      const counts = metadataCounts ?? (await db.messageCounts());
      // Only counts from the messages table prove a topic has no messages. Embedded metadata
      // can be out of date even when its total and time range still look right.
      this.#dbs.push({
        db,
        topics: metadataCounts ? names : new Set(counts.keys()),
        emptyThrough: new Map(),
      });
      for (const [topic, count] of counts) {
        messageCounts.set(topic, (messageCounts.get(topic) ?? 0) + count);
      }
    }
    let hasAnyMessages = false;
    for (const count of messageCounts.values()) {
      if (count > 0) {
        hasAnyMessages = true;
        break;
      }
    }
    if (!hasAnyMessages) {
      throw new Error("Bag contains no messages");
    }

    const alerts: PlayerAlert[] = [];
    const topics: TopicWithDecodingInfo[] = [];
    const topicStats = new Map<string, TopicStats>();
    // ROS 2 .db3 files do not contain message definitions, so we can only support well-known ROS types.
    const datatypes: RosDatatypes = new Map([...ROS2_TO_DEFINITIONS, ...basicDatatypes]);

    for (const topicDef of topicDefs) {
      const numMessages = messageCounts.get(topicDef.name);

      const topic: TopicWithDecodingInfo = {
        name: topicDef.name,
        schemaName: topicDef.type,
        messageEncoding: topicDef.serializationFormat,
      };

      if (numMessages != undefined) {
        topicStats.set(topicDef.name, { numMessages });
      }

      const parsedMsgdef = ROS2_TO_DEFINITIONS.get(topicDef.type);
      if (parsedMsgdef == undefined) {
        alerts.push({
          severity: "warn",
          message: `Topic "${topicDef.name}" has unsupported datatype "${topicDef.type}"`,
          tip: `ROS 2 .db3 files do not contain message definitions, so only well-known ROS types are supported in ${APP_CONFIG.productName}. As a workaround, you can convert the db3 file to mcap using the mcap CLI.`,
        });
      } else {
        // Create the full gendeps-like message definition so that parseChannel() can parse it.
        const typesToProcess = [parsedMsgdef];
        const typesForMessage: MessageDefinition[] = [];
        const seenTypes = new Set<string>();
        while (typesToProcess.length > 0) {
          const rosType = typesToProcess.shift()!;
          typesForMessage.push(rosType);
          for (const { type, isComplex } of rosType.definitions) {
            const fullTypeName = dataTypeToFullName(type);
            if (isComplex === true && !seenTypes.has(fullTypeName)) {
              const newComplexType = ROS2_TO_DEFINITIONS.get(fullTypeName);
              if (!newComplexType) {
                // Should in theory never happen as these are all well-known types
                throw new Error(
                  `invariant: Subtype ${fullTypeName} of type ${rosType.name} not found.`,
                );
              }
              typesToProcess.push(newComplexType);
              seenTypes.add(fullTypeName);
            }
          }
        }

        const messageDefinition = stringify(typesForMessage);
        topic.schemaData = this.#textEncoder.encode(messageDefinition);
        topic.schemaEncoding = "ros2msg";
        topics.push(topic);
      }
    }

    this.#start = start;
    this.#end = end;

    return {
      topics: Array.from(topics.values()),
      topicStats,
      start,
      end,
      alerts,
      profile: "ros2",
      datatypes,
      publishersByTopic: new Map(),
    };
  }

  public async *messageIterator(
    opt: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    if (this.#bag == undefined) {
      throw new Error(`Rosbag2DataProvider is not initialized`);
    }

    const topics = opt.topics;
    if (topics.size === 0) {
      return;
    }

    const start = opt.start ?? this.#start;
    const end = opt.end ?? this.#end;

    // Add 1 nsec to the end time because rosbag2 treats the time range as non-inclusive
    // of the exact end time.
    const inclusiveEndTime = addTime(end, { sec: 0, nsec: 1 });
    const msgIterator = this.#bag.readMessages({
      startTime: start,
      endTime: inclusiveEndTime,
      topics: Array.from(topics.keys()),
      rawMessages: true,
    });
    for await (const msg of msgIterator) {
      yield {
        type: "message-event",
        msgEvent: {
          topic: msg.topic.name,
          receiveTime: msg.timestamp,
          message: msg.data,
          sizeInBytes: msg.data.byteLength,
          schemaName: msg.topic.type,
        },
      };
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
  }: GetBackfillMessagesArgs): Promise<MessageEvent<Uint8Array>[]> {
    if (this.#bag == undefined) {
      throw new Error(`Rosbag2DataProvider is not initialized`);
    }
    // .db3 files only index time: read back from `time` in pages of rows until every topic has a
    // message or the file's start is reached, yielding between pages even when none matched
    const latest = new Map<string, MessageEvent<Uint8Array>>();
    const seekTimestamp = toNanoSec(time);
    for (const { db, topics: fileTopics, emptyThrough } of this.#dbs) {
      // Per file: a split recording's files may overlap in time
      const requested = [...topics.keys()].filter((topic) => fileTopics.has(topic));
      const found = new Set<string>();
      let next: { timestamp: bigint; id?: number } | undefined = { timestamp: seekTimestamp };
      while (next != undefined) {
        const { timestamp } = next;
        const missing = requested.filter((topic) => {
          const knownEmpty = emptyThrough.get(topic);
          return !found.has(topic) && (knownEmpty == undefined || timestamp > knownEmpty);
        });
        if (missing.length === 0) {
          break;
        }
        await yieldToWorker();
        abortSignal?.throwIfAborted();
        const page = db.backfillPage(next, missing, BACKFILL_PAGE_ROWS);
        for (const msg of page.found) {
          found.add(msg.topic.name);
          const prev = latest.get(msg.topic.name);
          if (prev && compare(prev.receiveTime, msg.timestamp) > 0) {
            continue;
          }
          latest.set(msg.topic.name, {
            topic: msg.topic.name,
            receiveTime: msg.timestamp,
            message: msg.data,
            sizeInBytes: msg.data.byteLength,
            schemaName: msg.topic.type,
          });
        }
        next = page.next;
      }
      // An immutable file's scanned prefix is still empty on later seeks. A seek further ahead
      // still searches the newer interval before reaching that prefix.
      for (const topic of requested) {
        const knownEmpty = emptyThrough.get(topic);
        if (!found.has(topic) && (knownEmpty == undefined || knownEmpty < seekTimestamp)) {
          emptyThrough.set(topic, seekTimestamp);
        }
      }
    }
    return [...latest.values()].sort((a, b) => compare(a.receiveTime, b.receiveTime));
  }
}

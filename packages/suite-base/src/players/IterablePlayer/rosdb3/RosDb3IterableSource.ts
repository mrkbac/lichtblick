// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { MessageDefinition } from "@foxglove/message-definition";
import { ROS2_TO_DEFINITIONS, Rosbag2 } from "@foxglove/rosbag2";
import { stringify } from "@foxglove/rosmsg";
import { Time, add as addTime, compare, toNanoSec } from "@foxglove/rostime";

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
import { SqliteRosDb3 } from "./SqliteRosDb3";

/** Rows of any topic a backfill page scans: bounds the synchronous SQLite work between yields */
const BACKFILL_PAGE_ROWS = 4096;

/** Lets the worker take a superseding seek's abort message: SQLite reads synchronously */
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

type BagFile = {
  db: SqliteRosDb3;
  topics: ReadonlySet<string>;
  emptyThrough: Map<string, bigint>;
};

export class RosDb3IterableSource implements ISerializedIterableSource {
  #files: File[];
  #bag?: Rosbag2;
  /** Each file with its message count per topic */
  #dbs: BagFile[] = [];
  #start: Time = { sec: 0, nsec: 0 };
  #end: Time = { sec: 0, nsec: 0 };
  #textEncoder = new TextEncoder();

  public readonly sourceType = "serialized";

  public constructor(files: File[]) {
    this.#files = files;
  }

  public async initialize(): Promise<Initialization> {
    const dbs = this.#files.map((file) => new SqliteRosDb3(file));
    const bag = new Rosbag2(dbs);
    try {
      await bag.open();
      return await this.#initializeBag(bag, dbs);
    } catch (error) {
      await bag.close();
      throw error;
    }
  }

  async #initializeBag(bag: Rosbag2, dbs: SqliteRosDb3[]): Promise<Initialization> {
    const [start, end] = await bag.timeRange();
    const topicDefs = await bag.readTopics();
    // Per file, so a backfill skips files without the topics it looks for
    const messageCounts = new Map<string, number>();
    const databases: BagFile[] = [];
    for (const db of dbs) {
      const metadataCounts = await db.embeddedMessageCounts();
      const counts = metadataCounts ?? (await db.messageCounts());
      // Embedded metadata can be stale. Only scanning the messages table proves a topic is empty.
      const names = metadataCounts
        ? (await db.readTopics()).map((topic) => topic.name)
        : counts.keys();
      databases.push({ db, topics: new Set(names), emptyThrough: new Map() });
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

    this.#bag = bag;
    this.#dbs = databases;
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
    const topicNames = Array.from(topics.keys());
    for (const { db } of this.#dbs) {
      // Iterate the files in selection order, like Rosbag2, with iterator cleanup on early return.
      for await (const msg of db.readMessages({
        startTime: start,
        endTime: inclusiveEndTime,
        topics: topicNames,
      })) {
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
  }

  public async terminate(): Promise<void> {
    const bag = this.#bag;
    this.#bag = undefined;
    this.#dbs = [];
    await bag?.close();
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
      let next: { timestamp: bigint; id?: bigint } | undefined = { timestamp: seekTimestamp };
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

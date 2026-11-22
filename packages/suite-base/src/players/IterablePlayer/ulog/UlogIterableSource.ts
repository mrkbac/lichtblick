// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
import { ros1 } from "@foxglove/rosmsg-msgs-common";
import { Time, compare, fromMicros, isTimeInRangeInclusive } from "@foxglove/rostime";
import { DataSectionMessage, MessageType, ULog } from "@foxglove/ulog";
import { BlobReader } from "@foxglove/ulog/web";

import Logger from "@lichtblick/log";
import { MessageEvent, ParameterValue } from "@lichtblick/suite";
import {
  MessageDefinitionsByTopic,
  ParsedMessageDefinitionsByTopic,
  Topic,
  TopicStats,
  PlayerAlert,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

import { messageDefinitionToRos, logLevelToRosout } from "./support";
import {
  IIterableSource,
  IteratorResult,
  Initialization,
  MessageIteratorArgs,
  GetBackfillMessagesArgs,
} from "../IIterableSource";

type UlogOptions = { type: "file"; file: File };

const CHUNK_SIZE = 1024 * 1024;
const LOG_TOPIC = "Log";
/** @foxglove/ulog's index id for log messages */
const LOG_MSG_ID = -1;

const log = Logger.getLogger(__filename);

export class UlogIterableSource implements IIterableSource {
  #options: UlogOptions;
  #ulog?: ULog;
  #logTopic = LOG_TOPIC;
  #idsByTopic = new Map<string, Set<number>>();
  #start?: Time;
  #end?: Time;

  public constructor(options: UlogOptions) {
    this.#options = options;
  }

  public async initialize(): Promise<Initialization> {
    const file = this.#options.file;
    const bytes = this.#options.file.size;
    log.debug(`initialize(${bytes} bytes)`);

    const startTime = performance.now();
    this.#ulog = new ULog(new BlobReader(file), { chunkSize: CHUNK_SIZE });
    await this.#ulog.open();
    const durationMs = performance.now() - startTime;
    log.debug(`opened in ${durationMs.toFixed(2)}ms`);

    const counts = this.#ulog.dataMessageCounts()!;
    const timeRange = this.#ulog.timeRange() ?? [0n, 0n];
    const start = fromMicros(Number(timeRange[0]));
    const end = fromMicros(Number(timeRange[1]));

    const alerts: PlayerAlert[] = [];
    const topics: Topic[] = [];
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const messageDefinitionsByTopic: MessageDefinitionsByTopic = {};
    const parsedMessageDefinitionsByTopic: ParsedMessageDefinitionsByTopic = {};
    const header = this.#ulog.header!;

    const dataNames = new Set(Array.from(this.#ulog.subscriptions.values(), (sub) => sub.name));
    this.#logTopic = LOG_TOPIC;
    for (let suffix = 2; dataNames.has(this.#logTopic); suffix++) {
      this.#logTopic = `${LOG_TOPIC}_${suffix}`;
    }
    this.#idsByTopic.clear();
    const logCount = this.#ulog.logCount() ?? 0;
    topics.push({ name: this.#logTopic, schemaName: "rosgraph_msgs/Log" });
    topicStats.set(this.#logTopic, { numMessages: logCount });
    if (logCount > 0) {
      this.#idsByTopic.set(this.#logTopic, new Set([LOG_MSG_ID]));
    }
    datatypes.set("rosgraph_msgs/Log", ros1["rosgraph_msgs/Log"]);

    for (const msgDef of header.definitions.values()) {
      datatypes.set(msgDef.name, messageDefinitionToRos(msgDef));
    }

    for (const [msgId, msgDef] of this.#ulog.subscriptions.entries()) {
      const count = counts.get(msgId);
      if (count == undefined || count === 0) {
        continue;
      }

      const name = msgDef.name;
      let ids = this.#idsByTopic.get(name);
      if (!ids) {
        ids = new Set();
        this.#idsByTopic.set(name, ids);
        topics.push({ name, schemaName: name });
        messageDefinitionsByTopic[name] = msgDef.format;
        const messageDefinition = datatypes.get(msgDef.name);
        if (messageDefinition) {
          parsedMessageDefinitionsByTopic[name] = [messageDefinition];
        }
      }
      ids.add(msgId);
      topicStats.set(name, { numMessages: (topicStats.get(name)?.numMessages ?? 0) + count });
    }

    const parameters = new Map<string, ParameterValue>();
    for (const [key, entry] of header.parameters.entries()) {
      parameters.set(key, entry.value);
    }

    log.debug(`message definitions parsed`);

    this.#start = start;
    this.#end = end;

    return {
      start,
      end,
      topics,
      datatypes,
      profile: "ulog",
      alerts,
      publishersByTopic: new Map(),
      topicStats,
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult>> {
    if (this.#ulog == undefined) {
      throw new Error(`UlogDataProvider is not initialized`);
    }

    const topics = args.topics;
    const start = args.start ?? this.#start;
    const end = args.end ?? this.#end;

    if (!start || !end) {
      throw new Error(`UlogDataProvider is not initialized`);
    }

    const msgIds = this.#msgIds(topics.keys());
    if (msgIds.size === 0) {
      return;
    }

    const startTime = toMicros(start, "ceil");
    const endTime = toMicros(end, "floor");
    for await (const msg of this.#ulog.readMessages({
      startTime,
      endTime,
      msgIds,
      includeLogs: false,
    })) {
      const msgEvent = this.#toMessageEvent(msg);
      if (
        msgEvent &&
        topics.has(msgEvent.topic) &&
        isTimeInRangeInclusive(msgEvent.receiveTime, start, end)
      ) {
        yield { type: "message-event", msgEvent };
      }
    }
  }

  public async getBackfillMessages({
    topics,
    time,
    abortSignal,
  }: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    if (this.#ulog == undefined) {
      throw new Error(`UlogDataProvider is not initialized`);
    }
    // One reverse pass for all topics. A topic's ids leave the set once it has its message, so the
    // reader skips its older messages in the index without reading them.
    const msgIds = this.#msgIds(topics.keys());
    if (msgIds.size === 0) {
      return [];
    }
    const latest = new Map<string, MessageEvent>();
    for await (const msg of this.#ulog.readMessages({
      endTime: toMicros(time, "floor"),
      msgIds,
      includeLogs: false,
      reverse: true,
      signal: abortSignal,
    })) {
      if (abortSignal?.aborted === true) {
        break;
      }
      const msgEvent = this.#toMessageEvent(msg);
      if (!msgEvent || !topics.has(msgEvent.topic) || latest.has(msgEvent.topic)) {
        continue;
      }
      latest.set(msgEvent.topic, msgEvent);
      for (const id of this.#idsByTopic.get(msgEvent.topic) ?? []) {
        msgIds.delete(id);
      }
      if (msgIds.size === 0) {
        break;
      }
    }
    return [...latest.values()].sort((a, b) => compare(a.receiveTime, b.receiveTime));
  }

  /** ULog message ids of the topics: only these are read and parsed */
  #msgIds(topics: Iterable<string>): Set<number> {
    const msgIds = new Set<number>();
    for (const topic of topics) {
      for (const id of this.#idsByTopic.get(topic) ?? []) {
        msgIds.add(id);
      }
    }
    return msgIds;
  }

  #toMessageEvent(msg: DataSectionMessage): MessageEvent | undefined {
    if (msg.type === MessageType.Data) {
      const timestamp = (msg.value as { timestamp: bigint }).timestamp;
      const sub = this.#ulog?.subscriptions.get(msg.msgId);
      if (!sub) {
        return undefined;
      }
      return {
        topic: sub.name,
        receiveTime: fromMicros(Number(timestamp)),
        message: msg.value,
        sizeInBytes: msg.data.byteLength,
        schemaName: sub.name,
      };
    } else if (msg.type === MessageType.Log || msg.type === MessageType.LogTagged) {
      const receiveTime = fromMicros(Number(msg.timestamp));
      return {
        topic: this.#logTopic,
        receiveTime,
        message: {
          file: "",
          function: "",
          header: { stamp: receiveTime },
          level: logLevelToRosout(msg.logLevel),
          line: 0,
          msg: msg.message,
          name: "",
        },
        schemaName: "rosgraph_msgs/Log",
        sizeInBytes: msg.size,
      };
    }
    return undefined;
  }
}

/** A Time in whole microseconds, without float rounding */
function toMicros(time: Time, round: "floor" | "ceil"): bigint {
  const micros = BigInt(time.sec) * 1_000_000n + BigInt(Math.floor(time.nsec / 1000));
  return round === "ceil" && time.nsec % 1000 !== 0 ? micros + 1n : micros;
}

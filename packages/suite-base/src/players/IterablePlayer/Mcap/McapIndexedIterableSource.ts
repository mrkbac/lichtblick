// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { McapIndexedReader, McapTypes } from "@mcap/core";

import Logger from "@lichtblick/log";
import { ParsedChannel, parseChannel } from "@lichtblick/mcap-support";
import { Time, fromNanoSec, toNanoSec, compare } from "@lichtblick/rostime";
import { MessageEvent, Metadata } from "@lichtblick/suite";
import {
  GetBackfillMessagesArgs,
  Initialization,
  ISerializedIterableSource,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { PlayerAlert, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";

const log = Logger.getLogger(__filename);

// Skim reads the last 50ms of each window: enough for every fast topic (and every publisher on
// a shared topic) to show up, while skipping the rest of the window's chunks.
const SKIM_TAIL_NS = 50_000_000n;
// Below this many chunks per window, skimming would re-decompress the same chunks; read linearly.
const SKIM_MIN_CHUNKS_PER_WINDOW = 4n;

export class McapIndexedIterableSource implements ISerializedIterableSource {
  #reader: McapIndexedReader;
  #channelInfoById = new Map<
    number,
    {
      channel: McapTypes.Channel;
      parsedChannel: ParsedChannel;
      schemaName: string | undefined;
    }
  >();
  #start?: Time;
  #end?: Time;
  #avgChunkDurationNs = 0n;

  public readonly sourceType = "serialized";

  public constructor(reader: McapIndexedReader) {
    this.#reader = reader;
  }

  public async initialize(): Promise<Initialization> {
    let startTime: bigint | undefined;
    let endTime: bigint | undefined;
    for (const chunk of this.#reader.chunkIndexes) {
      if (startTime == undefined || chunk.messageStartTime < startTime) {
        startTime = chunk.messageStartTime;
      }
      if (endTime == undefined || chunk.messageEndTime > endTime) {
        endTime = chunk.messageEndTime;
      }
    }

    const topicStats = new Map<string, TopicStats>();
    const topicsByName = new Map<string, TopicWithDecodingInfo>();
    const datatypes: RosDatatypes = new Map();
    const alerts: PlayerAlert[] = [];
    const metadata: Metadata[] = [];

    const publishersByTopic = new Map<string, Set<string>>();

    for (const channel of this.#reader.channelsById.values()) {
      const schema = this.#reader.schemasById.get(channel.schemaId);
      if (channel.schemaId !== 0 && schema == undefined) {
        alerts.push({
          severity: "error",
          message: `Missing schema info for schema id ${channel.schemaId} (channel ${channel.id}, topic ${channel.topic})`,
        });
        continue;
      }

      let parsedChannel;
      try {
        parsedChannel = parseChannel({ messageEncoding: channel.messageEncoding, schema });
      } catch (error) {
        alerts.push({
          severity: "error",
          message: `Error in topic ${channel.topic} (channel ${channel.id}): ${error.message}`,
          error,
        });
        continue;
      }
      this.#channelInfoById.set(channel.id, {
        channel,
        parsedChannel,
        schemaName: schema?.name,
      });

      let topic = topicsByName.get(channel.topic);
      if (!topic) {
        topic = {
          name: channel.topic,
          schemaName: schema?.name,
          messageEncoding: channel.messageEncoding,
          schemaData: schema?.data,
          schemaEncoding: schema?.encoding,
        };
        topicsByName.set(channel.topic, topic);

        const numMessages = this.#reader.statistics?.channelMessageCounts.get(channel.id);
        if (numMessages != undefined) {
          topicStats.set(channel.topic, { numMessages: Number(numMessages) });
        }
      }

      // Track the publisher for this topic. "callerid" is defined in the MCAP ROS 1 Well-known
      // profile at <https://mcap.dev/specification/appendix.html>. We skip the profile check to
      // allow non-ROS profiles to utilize this functionality as well
      const publisherId = channel.metadata.get("callerid") ?? String(channel.id);
      let publishers = publishersByTopic.get(channel.topic);
      if (!publishers) {
        publishers = new Set();
        publishersByTopic.set(channel.topic, publishers);
      }
      publishers.add(publisherId);

      // Final datatypes is an unholy union of schemas across all channels
      for (const [name, datatype] of parsedChannel.datatypes) {
        datatypes.set(name, datatype);
      }
    }

    if (startTime != undefined && endTime != undefined) {
      this.#avgChunkDurationNs =
        (endTime - startTime) / BigInt(Math.max(1, this.#reader.chunkIndexes.length));
    }
    this.#start = fromNanoSec(startTime ?? 0n);
    this.#end = fromNanoSec(endTime ?? startTime ?? 0n);

    const metadataGenerator = this.#reader.readMetadata();
    let metadataIterator = await metadataGenerator.next();
    while (metadataIterator.done !== true) {
      metadata.push({
        name: metadataIterator.value.name,
        metadata: Object.fromEntries(metadataIterator.value.metadata),
      });
      metadataIterator = await metadataGenerator.next();
    }

    return {
      start: this.#start,
      end: this.#end,
      topics: [...topicsByName.values()],
      datatypes,
      profile: this.#reader.header.profile,
      alerts,
      metadata,
      publishersByTopic,
      topicStats,
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    const topics = args.topics;
    const start = args.start ?? this.#start;
    const end = args.end ?? this.#end;

    if (topics.size === 0 || !start || !end) {
      return;
    }

    const topicNames = Array.from(topics.keys());

    const skimNs = args.skimInterval ? toNanoSec(args.skimInterval) : 0n;
    if (skimNs > SKIM_MIN_CHUNKS_PER_WINDOW * this.#avgChunkDurationNs) {
      yield* this.#skimMessages(toNanoSec(start), toNanoSec(end), skimNs, topicNames);
      return;
    }

    for await (const message of this.#reader.readMessages({
      startTime: toNanoSec(start),
      endTime: toNanoSec(end),
      topics: topicNames,
      validateCrcs: false,
    })) {
      yield this.#toResult(message);
    }
  }

  /**
   * Lossy fast-forward: per window only read the chunks at its tail, plus a reverse lookup for
   * topics with no message in the tail, so most chunks are never downloaded or decompressed.
   */
  async *#skimMessages(
    startNs: bigint,
    endNs: bigint,
    skimNs: bigint,
    topicNames: string[],
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    for (let windowStart = startNs; windowStart <= endNs; windowStart += skimNs) {
      const windowEnd = windowStart + skimNs - 1n < endNs ? windowStart + skimNs - 1n : endNs;
      const tailStart =
        windowEnd - SKIM_TAIL_NS > windowStart ? windowEnd - SKIM_TAIL_NS : windowStart;

      const messages: McapTypes.Message[] = [];
      const seen = new Set<string>();
      for await (const message of this.#reader.readMessages({
        startTime: tailStart,
        endTime: windowEnd,
        topics: topicNames,
        validateCrcs: false,
      })) {
        messages.push(message);
        const topic = this.#channelInfoById.get(message.channelId)?.channel.topic;
        if (topic != undefined) {
          seen.add(topic);
        }
      }

      const missing = new Set(topicNames.filter((topic) => !seen.has(topic)));
      if (missing.size > 0 && tailStart > windowStart) {
        messages.push(...(await this.#latestBefore(missing, windowStart, tailStart - 1n)));
      }

      messages.sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));
      for (const message of messages) {
        yield this.#toResult(message);
      }
      yield { type: "stamp", stamp: fromNanoSec(windowEnd) };
    }
  }

  /**
   * Latest message per topic in [start, end]. The chunk index tells which chunk holds each topic's
   * latest message, so only those chunks are decompressed (one reverse read per chunk), instead of
   * scanning back through every chunk until the slowest topic shows up.
   */
  async #latestBefore(
    topics: Set<string>,
    start: bigint,
    end: bigint,
  ): Promise<McapTypes.Message[]> {
    const latestChunkByTopic = new Map<string, McapTypes.ChunkIndex>();
    for (const chunk of this.#reader.chunkIndexes) {
      if (chunk.messageStartTime > end || chunk.messageEndTime < start) {
        continue;
      }
      for (const channelId of chunk.messageIndexOffsets.keys()) {
        const topic = this.#channelInfoById.get(channelId)?.channel.topic;
        if (topic == undefined || !topics.has(topic)) {
          continue;
        }
        const prev = latestChunkByTopic.get(topic);
        if (!prev || chunk.messageEndTime > prev.messageEndTime) {
          latestChunkByTopic.set(topic, chunk);
        }
      }
    }

    const topicsByChunk = new Map<McapTypes.ChunkIndex, string[]>();
    for (const [topic, chunk] of latestChunkByTopic) {
      topicsByChunk.set(chunk, [...(topicsByChunk.get(chunk) ?? []), topic]);
    }

    const messages: McapTypes.Message[] = [];
    for (const [chunk, chunkTopics] of topicsByChunk) {
      const found = new Set<string>();
      for await (const message of this.#reader.readMessages({
        startTime: chunk.messageStartTime > start ? chunk.messageStartTime : start,
        endTime: chunk.messageEndTime < end ? chunk.messageEndTime : end,
        topics: chunkTopics,
        reverse: true,
        validateCrcs: false,
      })) {
        const topic = this.#channelInfoById.get(message.channelId)?.channel.topic;
        if (topic == undefined || found.has(topic)) {
          continue;
        }
        found.add(topic);
        messages.push(message);
        if (found.size === chunkTopics.length) {
          break;
        }
      }
    }
    return messages;
  }

  #toResult(message: McapTypes.Message): Readonly<IteratorResult<Uint8Array>> {
    const channelInfo = this.#channelInfoById.get(message.channelId);
    if (!channelInfo) {
      return {
        type: "alert",
        connectionId: message.channelId,
        alert: {
          message: `Received message on channel ${message.channelId} without prior channel info`,
          severity: "error",
        },
      };
    }
    return {
      type: "message-event",
      msgEvent: {
        topic: channelInfo.channel.topic,
        receiveTime: fromNanoSec(message.logTime),
        publishTime: fromNanoSec(message.publishTime),
        message: message.data,
        sizeInBytes: message.data.byteLength,
        schemaName: channelInfo.schemaName ?? "",
      },
    };
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    const { topics, time } = args;

    const messages: MessageEvent<Uint8Array>[] = [];
    for (const topic of topics.keys()) {
      // NOTE: An iterator is made for each topic to get the latest message on that topic.
      // An single iterator for all the topics could result in iterating through many
      // irrelevant messages to get to an older message on a topic.
      for await (const message of this.#reader.readMessages({
        endTime: toNanoSec(time),
        topics: [topic],
        reverse: true,
        validateCrcs: false,
      })) {
        const channelInfo = this.#channelInfoById.get(message.channelId);
        if (!channelInfo) {
          log.error(`Missing channel info for channel: ${message.channelId} on topic: ${topic}`);
          continue;
        }

        messages.push({
          topic: channelInfo.channel.topic,
          receiveTime: fromNanoSec(message.logTime),
          publishTime: fromNanoSec(message.publishTime),
          message: message.data,
          sizeInBytes: message.data.byteLength,
          schemaName: channelInfo.schemaName ?? "",
        });

        break;
      }
    }
    messages.sort((a, b) => compare(a.receiveTime, b.receiveTime));
    return messages;
  }

  public getStart(): Time | undefined {
    return this.#start;
  }

  public getEnd(): Time | undefined {
    return this.#end;
  }
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Time, fromNanoSec, toNanoSec, compare } from "@foxglove/rostime";
import { McapIndexedReader, McapTypes } from "@mcap/core";

import Logger from "@lichtblick/log";
import { ParsedChannel, parseChannel } from "@lichtblick/mcap-support";
import { MessageEvent, Metadata } from "@lichtblick/suite";
import {
  GetBackfillMessagesArgs,
  Initialization,
  ISerializedIterableSource,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import { PlayerAlert, RecordingFileInfo, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { toError } from "@lichtblick/suite-base/util/toError";

const log = Logger.getLogger(__filename);

// Skim reads the last 50ms of each window: enough for every fast topic (and every publisher on
// a shared topic) to show up, while skipping the rest of the window's chunks.
const SKIM_TAIL_NS = 50_000_000n;
// How many chunks skimming prefetches ahead of the window it is reading
const SKIM_PREFETCH_AHEAD_CHUNKS = 24;

export type ByteRange = { offset: bigint; length: bigint };

/** Rebuilds a reader that skips corrupt chunks, after `error` was thrown while reading */
export type RecoverReader = (
  error: Error,
) => Promise<{ reader: McapIndexedReader; alert: PlayerAlert | undefined }>;

type ReadMessagesArgs = Omit<
  NonNullable<Parameters<McapIndexedReader["readMessages"]>[0]>,
  "validateCrcs"
>;

// Alerts from rebuilding the index mid-read; not a real channel id (those are uint16)
const RECOVERY_CONNECTION_ID = -1;

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
  #prefetch?: (ranges: ByteRange[]) => void;
  #recover?: RecoverReader;
  #recovering?: Promise<void>;
  // Set once the reader was rebuilt mid-read; yielded by the next messageIterator result
  #recoveryAlert?: PlayerAlert;
  // What initialize() has processed of the reader's index so far, and what it built from it
  #index = {
    chunks: 0,
    channels: new Set<number>(),
    pendingChannels: new Set<number>(),
    startTime: undefined as bigint | undefined,
    endTime: undefined as bigint | undefined,
    compression: new Map<string, RecordingFileInfo["compression"][number]>(),
    topicsByName: new Map<string, TopicWithDecodingInfo>(),
    datatypes: new Map() as RosDatatypes,
    publishersByTopic: new Map<string, Set<string>>(),
    alerts: [] as PlayerAlert[],
    metadataCount: 0,
    metadata: [] as Metadata[],
  };

  public readonly sourceType = "serialized";

  /**
   * @param options.prefetch Fetches byte ranges ahead of time so the reader later hits a local
   * copy. Remote sources pass it so skimming can fetch upcoming chunks in parallel.
   * @param options.recover Called once if reading throws (e.g. a corrupt chunk); reading resumes
   * on the reader it returns.
   */
  public constructor(
    reader: McapIndexedReader,
    options?: { prefetch?: (ranges: ByteRange[]) => void; recover?: RecoverReader },
  ) {
    this.#reader = reader;
    this.#prefetch = options?.prefetch;
    this.#recover = options?.recover;
  }

  /**
   * `reader.readMessages`, but a read error swaps in a recovered reader (once) and resumes after
   * the last message already yielded, so consumers see one uninterrupted stream.
   */
  async *#readMessages(args: ReadMessagesArgs): AsyncGenerator<McapTypes.Message> {
    // Resume point: the last yielded logTime and how many messages at that logTime were yielded
    let lastTime: bigint | undefined;
    let yieldedAtLastTime = 0;
    let retried = false;
    for (;;) {
      const resumeArgs: ReadMessagesArgs =
        lastTime == undefined
          ? args
          : args.reverse === true
            ? { ...args, endingAt: lastTime }
            : { ...args, startingAt: lastTime };
      let skip = yieldedAtLastTime;
      const reader = this.#reader;
      const messages = reader.readMessages({ ...resumeArgs, validateCrcs: false });
      try {
        for (;;) {
          let result;
          try {
            result = await messages.next();
          } catch (err: unknown) {
            // Retry once first: a transient error (e.g. the network) needs no scan. Then, unless
            // another read already swapped the reader, recover (once, shared by every read); an
            // error from the recovered reader is rethrown, so reading never loops.
            if (this.#reader === reader && retried) {
              const recover = this.#recover;
              if (!recover) {
                throw err;
              }
              this.#recovering ??= recover(toError(err)).then(({ reader: next, alert }) => {
                this.#reader = next;
                this.#recover = undefined;
                this.#recoveryAlert = alert;
              });
              await this.#recovering;
              retried = false;
            } else {
              retried = this.#reader === reader;
            }
            break;
          }
          if (result.done === true) {
            return;
          }
          const message = result.value;
          if (message.logTime === lastTime && skip > 0) {
            skip--; // already yielded before the reader was swapped
            continue;
          }
          if (message.logTime === lastTime) {
            yieldedAtLastTime++;
          } else {
            lastTime = message.logTime;
            yieldedAtLastTime = 1;
          }
          retried = false;
          yield message;
        }
      } finally {
        await messages.return(undefined);
      }
    }
  }

  /** The alert for a recovery that happened while reading, once */
  #takeRecoveryAlert(): Readonly<IteratorResult<Uint8Array>> | undefined {
    const alert = this.#recoveryAlert;
    this.#recoveryAlert = undefined;
    return alert ? { type: "alert", connectionId: RECOVERY_CONNECTION_ID, alert } : undefined;
  }

  /**
   * Can be called again after the reader's index grew (see McapRecoveryScanner.openLiveReader):
   * only chunks and channels added since the last call are processed, so the cost per call is
   * O(what is new + channels), not O(chunks).
   */
  public async initialize(): Promise<Initialization> {
    const reader = this.#reader;
    const index = this.#index;
    for (const chunk of reader.chunkIndexes.slice(index.chunks)) {
      if (index.startTime == undefined || chunk.messageStartTime < index.startTime) {
        index.startTime = chunk.messageStartTime;
      }
      if (index.endTime == undefined || chunk.messageEndTime > index.endTime) {
        index.endTime = chunk.messageEndTime;
      }
      const format = chunk.compression || "none";
      const group = index.compression.get(format) ?? {
        format,
        compressedBytes: 0,
        uncompressedBytes: 0,
      };
      group.compressedBytes += Number(chunk.compressedSize);
      group.uncompressedBytes += Number(chunk.uncompressedSize);
      index.compression.set(format, group);
    }
    index.chunks = reader.chunkIndexes.length;

    // A channel whose schema is missing stays pending: a later chunk may repeat the schema. Once
    // added, its messages in earlier chunks become readable too.
    const missingSchemaAlerts: PlayerAlert[] = [];
    let revived = false;
    for (const channel of reader.channelsById.values()) {
      if (index.channels.has(channel.id)) {
        continue;
      }
      if (channel.schemaId !== 0 && !reader.schemasById.has(channel.schemaId)) {
        missingSchemaAlerts.push({
          severity: "error",
          message: `Missing schema info for schema id ${channel.schemaId} (channel ${channel.id}, topic ${channel.topic})`,
        });
        index.pendingChannels.add(channel.id);
        continue;
      }
      revived ||= index.pendingChannels.delete(channel.id);
      index.channels.add(channel.id);
      this.#addChannel(channel);
    }

    const { startTime, endTime } = index;
    if (startTime != undefined && endTime != undefined) {
      this.#avgChunkDurationNs =
        (endTime - startTime) / BigInt(Math.max(1, reader.chunkIndexes.length));
    }
    this.#start = fromNanoSec(startTime ?? 0n);
    this.#end = fromNanoSec(endTime ?? startTime ?? 0n);

    const metadataCount = reader.metadataIndexes.length;
    if (index.metadataCount !== metadataCount) {
      // Committed only once every record was read, so a failed read is retried next time
      const metadata: Metadata[] = [];
      for await (const record of reader.readMetadata()) {
        metadata.push({ name: record.name, metadata: Object.fromEntries(record.metadata) });
      }
      index.metadata = metadata;
      index.metadataCount = metadataCount;
    }

    const topicStats = new Map<string, TopicStats>();
    for (const { channel } of this.#channelInfoById.values()) {
      const numMessages = reader.statistics?.channelMessageCounts.get(channel.id);
      if (numMessages != undefined) {
        const previous = topicStats.get(channel.topic)?.numMessages ?? 0;
        topicStats.set(channel.topic, { numMessages: previous + Number(numMessages) });
      }
    }

    const recordingFiles: RecordingFileInfo[] = [
      {
        library: reader.header.library,
        schemaCount: reader.schemasById.size,
        compression: [...index.compression.values()].map((group) => ({ ...group })),
        channels: [...reader.channelsById.values()].map((channel) => {
          const schema = reader.schemasById.get(channel.schemaId);
          return {
            id: channel.id,
            topic: channel.topic,
            schemaName: schema?.name,
            messageEncoding: channel.messageEncoding,
            schemaEncoding: schema?.encoding,
            metadata: Object.fromEntries(channel.metadata),
          };
        }),
        attachments: reader.attachmentIndexes.map((attachment) => ({
          name: attachment.name,
          mediaType: attachment.mediaType,
          sizeBytes: Number(attachment.dataSize),
        })),
      },
    ];

    return {
      recordingFiles,
      start: this.#start,
      end: this.#end,
      topics: [...index.topicsByName.values()],
      datatypes: new Map(index.datatypes),
      profile: reader.header.profile,
      alerts: [...index.alerts, ...missingSchemaAlerts],
      metadata: index.metadata,
      publishersByTopic: new Map(
        [...index.publishersByTopic].map(([topic, publishers]) => [topic, new Set(publishers)]),
      ),
      topicStats,
      // What the caller reports as changed is only its new chunks, unless earlier ones changed too
      updatedRanges: revived ? undefined : [],
    };
  }

  /** Parses a channel the index didn't have yet and adds its topic, datatypes and publisher */
  #addChannel(channel: McapTypes.Channel): void {
    const index = this.#index;
    const schema = this.#reader.schemasById.get(channel.schemaId);
    let parsedChannel;
    try {
      parsedChannel = parseChannel({ messageEncoding: channel.messageEncoding, schema });
    } catch (error) {
      index.alerts.push({
        severity: "error",
        message: `Error in topic ${channel.topic} (channel ${channel.id}): ${toError(error).message}`,
        error: toError(error),
      });
      return;
    }
    this.#channelInfoById.set(channel.id, { channel, parsedChannel, schemaName: schema?.name });

    if (!index.topicsByName.has(channel.topic)) {
      index.topicsByName.set(channel.topic, {
        name: channel.topic,
        schemaName: schema?.name,
        messageEncoding: channel.messageEncoding,
        schemaData: schema?.data,
        schemaEncoding: schema?.encoding,
      });
    }

    // Track the publisher for this topic. "callerid" is defined in the MCAP ROS 1 Well-known
    // profile at <https://mcap.dev/specification/appendix.html>. We skip the profile check to
    // allow non-ROS profiles to utilize this functionality as well
    const publisherId = channel.metadata.get("callerid") ?? String(channel.id);
    let publishers = index.publishersByTopic.get(channel.topic);
    if (!publishers) {
      publishers = new Set();
      index.publishersByTopic.set(channel.topic, publishers);
    }
    publishers.add(publisherId);

    // Final datatypes is an unholy union of schemas across all channels
    for (const [name, datatype] of parsedChannel.datatypes) {
      index.datatypes.set(name, datatype);
    }
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

    for await (const message of this.#readMessages({
      startingAt: toNanoSec(start),
      endingAt: toNanoSec(end),
      topics: topicNames,
    })) {
      const alert = this.#takeRecoveryAlert();
      if (alert) {
        yield alert;
      }
      yield this.#toResult(message);
    }
    const alert = this.#takeRecoveryAlert();
    if (alert) {
      yield alert;
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
    const windowBounds = (windowStart: bigint) => {
      const windowEnd = windowStart + skimNs - 1n < endNs ? windowStart + skimNs - 1n : endNs;
      const tailStart =
        windowEnd - SKIM_TAIL_NS > windowStart ? windowEnd - SKIM_TAIL_NS : windowStart;
      return { windowEnd, tailStart };
    };
    const topicSet = new Set(topicNames);
    // Chunks requested from #prefetch that the reader hasn't reached yet, and the next window to plan
    const prefetched: McapTypes.ChunkIndex[][] = [];
    let nextPrefetchWindow = startNs;

    for (let windowStart = startNs; windowStart <= endNs; windowStart += skimNs) {
      const { windowEnd, tailStart } = windowBounds(windowStart);

      if (this.#prefetch) {
        prefetched.shift();
        const ranges: ByteRange[] = [];
        while (
          nextPrefetchWindow <= endNs &&
          prefetched.reduce((n, chunks) => n + chunks.length, 0) < SKIM_PREFETCH_AHEAD_CHUNKS
        ) {
          const bounds = windowBounds(nextPrefetchWindow);
          const chunks = this.#skimChunks(
            topicSet,
            nextPrefetchWindow,
            bounds.windowEnd,
            bounds.tailStart,
          );
          prefetched.push(chunks);
          ranges.push(...chunks.map(chunkByteRange));
          nextPrefetchWindow += skimNs;
        }
        if (ranges.length > 0) {
          this.#prefetch(ranges);
        }
      }

      const messages: McapTypes.Message[] = [];
      const seen = new Set<string>();
      for await (const message of this.#readMessages({
        startingAt: tailStart,
        endingAt: windowEnd,
        topics: topicNames,
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
      const alert = this.#takeRecoveryAlert();
      if (alert) {
        yield alert;
      }
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
    const latestChunkByTopic = this.#latestChunkByTopic(topics, start, end);

    const topicsByChunk = new Map<McapTypes.ChunkIndex, string[]>();
    for (const [topic, chunk] of latestChunkByTopic) {
      topicsByChunk.set(chunk, [...(topicsByChunk.get(chunk) ?? []), topic]);
    }

    const messages: McapTypes.Message[] = [];
    for (const [chunk, chunkTopics] of topicsByChunk) {
      const found = new Set<string>();
      for await (const message of this.#readMessages({
        startingAt: chunk.messageStartTime > start ? chunk.messageStartTime : start,
        endingAt: chunk.messageEndTime < end ? chunk.messageEndTime : end,
        topics: chunkTopics,
        reverse: true,
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

  /** The chunk holding each topic's latest message in [start, end], from the chunk index alone */
  #latestChunkByTopic(
    topics: Set<string>,
    start: bigint,
    end: bigint,
  ): Map<string, McapTypes.ChunkIndex> {
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
    return latestChunkByTopic;
  }

  /**
   * Chunks a skim window may read: those overlapping its tail, and per topic its latest chunk plus
   * the chunks holding that topic that overlap it in time, since the topic's latest message can be
   * in any of them.
   */
  #skimChunks(
    topics: Set<string>,
    windowStart: bigint,
    windowEnd: bigint,
    tailStart: bigint,
  ): McapTypes.ChunkIndex[] {
    const chunks = new Set<McapTypes.ChunkIndex>();
    const latest = this.#latestChunkByTopic(topics, windowStart, windowEnd);
    for (const chunk of this.#reader.chunkIndexes) {
      if (chunk.messageStartTime > windowEnd || chunk.messageEndTime < windowStart) {
        continue;
      }
      if (chunk.messageEndTime >= tailStart) {
        chunks.add(chunk);
        continue;
      }
      for (const channelId of chunk.messageIndexOffsets.keys()) {
        const topic = this.#channelInfoById.get(channelId)?.channel.topic;
        const latestChunk = topic != undefined ? latest.get(topic) : undefined;
        if (latestChunk && chunk.messageEndTime >= latestChunk.messageStartTime) {
          chunks.add(chunk);
          break;
        }
      }
    }
    return [...chunks];
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
      for await (const message of this.#readMessages({
        // Explicit: a live reader's default lower bound is the start when it was opened
        startingAt: 0n,
        endingAt: toNanoSec(time),
        topics: [topic],
        reverse: true,
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

/** The chunk record and the message indexes that follow it */
function chunkByteRange(chunk: McapTypes.ChunkIndex): ByteRange {
  let end = chunk.chunkStartOffset + chunk.chunkLength;
  if (chunk.messageIndexOffsets.size > 0) {
    const firstIndex = [...chunk.messageIndexOffsets.values()].reduce((a, b) => (b < a ? b : a));
    // Only where they follow the chunk; a rebuilt index keeps them elsewhere (in memory)
    if (firstIndex === end) {
      end = firstIndex + chunk.messageIndexLength;
    }
  }
  return { offset: chunk.chunkStartOffset, length: end - chunk.chunkStartOffset };
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { crc32 } from "@foxglove/crc";
import { Time, fromNanoSec, subtract, toNanoSec, toSec, toRFC3339String } from "@foxglove/rostime";
import * as _ from "lodash-es";

import {
  ChunkCache,
  MCAP_MAGIC,
  McapByteReader,
  McapTypes,
  Opcode,
  isKnownOpcode,
  parseRecord,
} from "@lichtblick/mcap-core";
import { loadDecompressHandlers, parseChannel, ParsedChannel } from "@lichtblick/mcap-support";
import { Metadata } from "@lichtblick/suite";
import {
  GetBackfillMessagesArgs,
  Initialization,
  ISerializedIterableSource,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "@lichtblick/suite-base/players/IterablePlayer/IIterableSource";
import {
  MessageEvent,
  PlayerAlert,
  RecordingFileInfo,
  TopicStats,
} from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import type { ReadOptions } from "@lichtblick/suite-base/util/CachedFilelike.types";
import { abortable } from "@lichtblick/suite-base/util/abortable";
import { toError } from "@lichtblick/suite-base/util/toError";

const DURATION_YEAR_SEC = 365 * 24 * 60 * 60;
const RECORD_PREFIX_BYTES = 9; // opcode + content length
/** Message record: opcode, length, channel id (u16), sequence (u32), log time, publish time, data */
const MESSAGE_LOG_TIME_AT = 15;
const MESSAGE_PUBLISH_TIME_AT = 23;
const MESSAGE_DATA_AT = 31;
const READ_WINDOW_BYTES = 8 * 1024 * 1024;
/** How far ahead a message read looks for more wanted messages to read in the same window */
const LOOKAHEAD_MESSAGES = 4096;

type Options = {
  readable: McapTypes.IReadable<ReadOptions>;
  chunkCache?: ChunkCache;
  recordIdPrefix?: string;
  /** Read only the first `size` bytes (e.g. the readable records of a damaged file) */
  size?: number;
};

type ChannelInfo = {
  channel: McapTypes.Channel;
  parsedChannel: ParsedChannel;
  schemaName: string | undefined;
  schemaEncoding: string | undefined;
  schemaData: Uint8Array | undefined;
};

/**
 * Where every message is, one entry per message in compact columns (26 bytes each), sorted by log
 * time. `chunk` is -1 for a message outside chunks, whose `position` is its record's file offset;
 * otherwise `position` is its record's offset in the decompressed chunk.
 */
type MessageIndex = {
  count: number;
  logTimes: BigUint64Array;
  positions: Float64Array;
  lengths: Uint32Array;
  chunks: Int32Array;
  channels: Uint16Array;
};

/**
 * Reads a file without a usable index (e.g. written without chunks, or damaged): one forward scan
 * indexes where each message is, and messages are read from the readable when asked for, so memory
 * stays flat and files of any size open.
 */
export class McapUnindexedIterableSource implements ISerializedIterableSource {
  #options: Options;
  #index?: MessageIndex;
  #channelInfoById = new Map<number, ChannelInfo>();
  #chunkOffsets: number[] = [];
  #chunkLengths: number[] = [];
  #chunkCache: ChunkCache;
  #chunkLoads = new Map<number, Promise<Uint8Array>>();
  #decompressHandlers?: McapTypes.DecompressHandlers;
  #size = 0;
  #start?: Time;
  #end?: Time;

  public readonly sourceType = "serialized";

  public constructor(options: Options) {
    this.#options = options;
    this.#chunkCache = options.chunkCache ?? new ChunkCache();
  }

  public async initialize(): Promise<Initialization> {
    const decompressHandlers = (this.#decompressHandlers = await loadDecompressHandlers());
    const { readable } = this.#options;
    const size = (this.#size = this.#options.size ?? Number(await readable.size()));
    const reader = new WindowedReader(readable, size);
    this.#channelInfoById = new Map();
    this.#chunkOffsets = [];
    this.#chunkLengths = [];
    this.#chunkCache.clear();
    this.#chunkLoads.clear();

    const alerts: PlayerAlert[] = [];
    const reportedConflicts = new Set<string>();
    const metadata: Metadata[] = [];
    const channelIdsWithErrors = new Set<number>();
    const schemasById = new Map<number, McapTypes.Schema>();
    const channelInfoById = this.#channelInfoById;
    const columns = new IndexBuilder();
    let profile: string | undefined;
    let library = "";
    const attachments: RecordingFileInfo["attachments"] = [];
    const compression = new Map<string, RecordingFileInfo["compression"][number]>();
    let corruptChunks = 0;
    let firstChunkError: string | undefined;
    let corruptRecords = 0;

    // Duplicate ids with different content: keep the first definition and say so, instead of
    // giving up on the whole file
    const processRecord = (record: McapTypes.TypedMcapRecord) => {
      switch (record.type) {
        case "Header":
          profile = record.profile;
          library = record.library;
          break;
        case "Metadata":
          metadata.push({ name: record.name, metadata: Object.fromEntries(record.metadata) });
          break;
        case "Schema": {
          const existing = schemasById.get(record.id);
          if (!existing) {
            schemasById.set(record.id, record);
          } else if (!_.isEqual(existing, record) && !reportedConflicts.has(`s${record.id}`)) {
            reportedConflicts.add(`s${record.id}`);
            alerts.push({
              severity: "warn",
              message: `Schema ${record.id} is defined twice with different content`,
              tip: `The first definition (${existing.name}) is used; the later one (${record.name}) is ignored.`,
            });
          }
          break;
        }
        case "Channel": {
          const existing = channelInfoById.get(record.id);
          if (existing) {
            if (!_.isEqual(existing.channel, record) && !reportedConflicts.has(`c${record.id}`)) {
              reportedConflicts.add(`c${record.id}`);
              alerts.push({
                severity: "warn",
                message: `Channel ${record.id} is defined twice with different content`,
                tip: `Its messages are read as ${existing.channel.topic}, the first definition; the later one (${record.topic}) is ignored.`,
              });
            }
            break;
          }
          if (channelIdsWithErrors.has(record.id)) {
            break;
          }
          const schema = schemasById.get(record.schemaId);
          try {
            if (record.schemaId !== 0 && !schema) {
              throw new Error(`Schema ${record.schemaId} is not defined before it`);
            }
            const parsedChannel = parseChannel({ messageEncoding: record.messageEncoding, schema });
            channelInfoById.set(record.id, {
              channel: record,
              parsedChannel,
              schemaName: schema?.name,
              schemaEncoding: schema?.encoding,
              schemaData: schema?.data,
            });
          } catch (error) {
            channelIdsWithErrors.add(record.id);
            alerts.push({
              severity: "error",
              message: `Error in topic ${record.topic} (channel ${record.id}): ${toError(error).message}`,
              error: toError(error),
            });
          }
          break;
        }
        default:
          break;
      }
    };

    const processChunk = (bytes: Uint8Array, offset: number) => {
      const chunk = parseRecord(byteReader(bytes), true);
      if (chunk?.type !== "Chunk") {
        throw new Error("Unreadable chunk");
      }
      const records = decompress(decompressHandlers, chunk);
      const chunkIndex = this.#chunkOffsets.length;
      const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
      const countBefore = columns.count;
      // Definitions take effect only once the whole chunk reads, so a broken chunk can't claim
      // channel ids that a later valid definition should get
      const definitions: McapTypes.TypedMcapRecord[] = [];
      try {
        for (let at = 0; at < records.byteLength; ) {
          const end = recordEnd(view, at);
          const opcode = records[at];
          if (opcode === Opcode.MESSAGE) {
            if (end - at < MESSAGE_DATA_AT) {
              throw new Error("Message record is too short");
            }
            columns.add(view, at, end - at, chunkIndex, at);
          } else if (opcode === Opcode.SCHEMA || opcode === Opcode.CHANNEL) {
            const record = parseRecord(byteReader(records.subarray(at, end)), true);
            if (record) {
              definitions.push(record);
            }
          }
          at = end;
        }
      } catch (error) {
        columns.count = countBefore; // a chunk that fails halfway adds no messages
        throw error;
      }
      definitions.forEach(processRecord);
      this.#chunkOffsets.push(offset);
      this.#chunkLengths.push(bytes.byteLength);
      const format = chunk.compression || "none";
      let group = compression.get(format);
      if (!group) {
        group = { format, compressedBytes: 0, uncompressedBytes: 0 };
        compression.set(format, group);
      }
      group.compressedBytes += chunk.records.byteLength;
      group.uncompressedBytes += Number(chunk.uncompressedSize);
    };

    const magic = await reader.read(0, MCAP_MAGIC.length);
    if (!MCAP_MAGIC.every((byte, i) => magic[i] === byte)) {
      throw new Error("File does not start with the MCAP magic bytes");
    }
    let offset = MCAP_MAGIC.length;
    while (offset + RECORD_PREFIX_BYTES <= size) {
      const prefix =
        reader.peek(offset, RECORD_PREFIX_BYTES) ??
        (await reader.read(offset, RECORD_PREFIX_BYTES, offset + READ_WINDOW_BYTES));
      const prefixView = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
      const opcode = prefix[0]!;
      const length = RECORD_PREFIX_BYTES + Number(prefixView.getBigUint64(1, true));
      if (offset + length > size) {
        alerts.push({
          severity: "warn",
          message: "This file ends in the middle of a record",
          tip: `The last ${size - offset} bytes could not be read.`,
        });
        break;
      }
      if (opcode === Opcode.DATA_END || opcode === Opcode.FOOTER) {
        break;
      }
      // Opcodes 0x80+ are private records and fine to skip; anything else unknown is garbage
      if (opcode < 0x80 && !isKnownOpcode(opcode)) {
        alerts.push({
          severity: "warn",
          message: "This file has unreadable data",
          tip: `Reading stopped at byte ${offset}; the last ${size - offset} bytes are not shown.`,
        });
        break;
      }
      // Reads stay outside the try blocks: a failed read fails the scan instead of quietly
      // opening part of the file. Only records that don't parse are skipped as corrupt.
      switch (opcode) {
        case Opcode.MESSAGE: {
          if (length < MESSAGE_DATA_AT) {
            corruptRecords++;
            break;
          }
          const head =
            reader.peek(offset, MESSAGE_DATA_AT) ?? (await reader.read(offset, MESSAGE_DATA_AT));
          columns.add(new DataView(head.buffer, head.byteOffset), 0, length, -1, offset);
          break;
        }
        case Opcode.CHUNK: {
          const bytes = await reader.read(offset, length);
          try {
            processChunk(bytes, offset);
          } catch (error) {
            corruptChunks++;
            firstChunkError ??= toError(error).message;
          }
          break;
        }
        case Opcode.ATTACHMENT: {
          const attachment = await readAttachmentInfo(reader, offset, length);
          if (attachment) {
            attachments.push(attachment);
          } else {
            corruptRecords++;
          }
          break;
        }
        case Opcode.HEADER:
        case Opcode.SCHEMA:
        case Opcode.CHANNEL:
        case Opcode.METADATA: {
          const bytes = await reader.read(offset, length);
          let record: McapTypes.TypedMcapRecord | undefined;
          try {
            record = parseRecord(byteReader(bytes), true);
          } catch {
            corruptRecords++;
          }
          if (record) {
            processRecord(record);
          }
          break;
        }
        default:
          break; // indexes: not needed, and not read
      }
      offset += length;
    }

    if (corruptChunks > 0 || corruptRecords > 0) {
      alerts.push({
        severity: "warn",
        message: "Some records in this file are corrupt and were skipped",
        tip:
          `${corruptChunks} chunks and ${corruptRecords} other records could not be read.` +
          (firstChunkError != undefined ? ` First chunk error: ${firstChunkError}.` : ""),
      });
    }

    const { index, orphans } = columns.finish((channelId) => channelInfoById.has(channelId));
    this.#index = index;
    for (const [channelId, count] of orphans) {
      if (!channelIdsWithErrors.has(channelId)) {
        alerts.push({
          severity: "warn",
          message: `${count} messages on channel ${channelId} were skipped`,
          tip: "The file has no channel record for them.",
        });
      }
    }

    const topics: TopicWithDecodingInfo[] = [];
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const publishersByTopic = new Map<string, Set<string>>();
    const countsByChannel = new Map<number, number>();
    for (let i = 0; i < index.count; i++) {
      const channelId = index.channels[i]!;
      countsByChannel.set(channelId, (countsByChannel.get(channelId) ?? 0) + 1);
    }

    for (const info of channelInfoById.values()) {
      const { channel, parsedChannel } = info;
      topics.push({
        name: channel.topic,
        messageEncoding: channel.messageEncoding,
        schemaName: info.schemaName,
        schemaData: info.schemaData,
        schemaEncoding: info.schemaEncoding,
      });
      topicStats.set(channel.topic, {
        numMessages:
          (topicStats.get(channel.topic)?.numMessages ?? 0) +
          (countsByChannel.get(channel.id) ?? 0),
      });

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

    this.#start = index.count > 0 ? fromNanoSec(index.logTimes[0]!) : { sec: 0, nsec: 0 };
    this.#end = index.count > 0 ? fromNanoSec(index.logTimes[index.count - 1]!) : this.#start;

    const fileDuration = toSec(subtract(this.#end, this.#start));
    if (fileDuration > DURATION_YEAR_SEC) {
      const startRfc = toRFC3339String(this.#start);
      const endRfc = toRFC3339String(this.#end);

      alerts.push({
        message: "This file has an abnormally long duration.",
        tip: `The start ${startRfc} and end ${endRfc} are greater than a year.`,
        severity: "warn",
      });
    }

    if (index.count === 0) {
      alerts.push({
        message: "This file contains no messages.",
        severity: "warn",
      });
    } else {
      alerts.push({
        message: "This file is unindexed. Unindexed files may have degraded performance.",
        tip: "See the MCAP spec: https://mcap.dev/specification/index.html#summary-section",
        severity: "warn",
      });
    }

    return {
      start: this.#start,
      end: this.#end,
      topics,
      datatypes,
      profile,
      alerts,
      publishersByTopic,
      topicStats,
      metadata,
      recordingFiles: [
        {
          library,
          footerIndexed: false,
          channels: [...channelInfoById.values()].map(
            ({ channel, schemaName, schemaEncoding }) => ({
              id: channel.id,
              topic: channel.topic,
              schemaName,
              schemaEncoding,
              messageEncoding: channel.messageEncoding,
              metadata: Object.fromEntries(channel.metadata),
            }),
          ),
          schemaCount: schemasById.size,
          compression: [...compression.values()],
          attachments,
        },
      ],
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    const index = this.#index;
    if (!index) {
      throw new Error("initialization not completed");
    }
    const start = args.start ?? this.#start;
    const end = args.end ?? this.#end;
    if (args.topics.size === 0 || !start || !end) {
      return;
    }
    const wanted = this.#wantedChannels(args.topics);
    const endNs = toNanoSec(end);
    const readOptions: ReadOptions = {
      signal: args.abort,
      background: args.consumptionType === "full",
    };
    const reader = new WindowedReader(this.#options.readable, this.#size, readOptions);
    for (
      let i = lowerBound(index, toNanoSec(start));
      i < index.count && index.logTimes[i]! <= endNs && args.abort?.aborted !== true;
      i++
    ) {
      if (wanted[index.channels[i]!] !== 1) {
        continue;
      }
      // Most reads hit the current window or a cached chunk: no await for those
      const record =
        this.#peekRecord(i, reader) ??
        (await this.#loadRecord(i, reader, (from) => {
          // Read up to the further wanted messages close by in the same window
          let until = 0;
          const windowEnd = from + READ_WINDOW_BYTES;
          const last = Math.min(index.count, i + LOOKAHEAD_MESSAGES);
          for (let j = i; j < last && index.logTimes[j]! <= endNs; j++) {
            const at = index.positions[j]!;
            const to = at + index.lengths[j]!;
            if (wanted[index.channels[j]!] === 1 && index.chunks[j] === -1 && at >= from) {
              if (to <= windowEnd) {
                until = Math.max(until, to);
              }
            }
          }
          return until;
        }));
      yield { type: "message-event", msgEvent: this.#messageEvent(i, record) };
    }
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    const index = this.#index;
    if (!index) {
      throw new Error("initialization not completed");
    }
    const wanted = this.#wantedChannels(args.topics);
    const reader = new WindowedReader(this.#options.readable, this.#size);
    const found = new Map<string, MessageEvent<Uint8Array>>();
    // ponytail: walks back message by message; a topic that is rare or absent before `time` costs a
    // pass over the index (a typed-array walk, fast up to tens of millions of messages)
    for (
      let i = lowerBound(index, toNanoSec(args.time) + 1n) - 1;
      i >= 0 && found.size < args.topics.size;
      i--
    ) {
      const channelId = index.channels[i]!;
      const topic = this.#channelInfoById.get(channelId)?.channel.topic;
      if (wanted[channelId] === 1 && topic != undefined && !found.has(topic)) {
        let record = this.#peekRecord(i, reader);
        if (!record) {
          // A seek moved on: stop before another read instead of holding up the next backfill
          if (args.abortSignal?.aborted === true) {
            return [];
          }
          record = await this.#loadRecord(i, reader);
        }
        found.set(topic, this.#messageEvent(i, record));
      }
    }
    return [...found.values()];
  }

  public getStart(): Time | undefined {
    return this.#start;
  }

  public getEnd(): Time | undefined {
    return this.#end;
  }

  #wantedChannels(topics: ReadonlyMap<string, unknown>): Uint8Array {
    const wanted = new Uint8Array(65536);
    for (const [id, { channel }] of this.#channelInfoById) {
      if (topics.has(channel.topic)) {
        wanted[id] = 1;
      }
    }
    return wanted;
  }

  /** The record of message `i` if it is in the reader's window or a cached chunk */
  #peekRecord(i: number, reader: WindowedReader): Uint8Array | undefined {
    const index = this.#index!;
    const position = index.positions[i]!;
    const length = index.lengths[i]!;
    const chunk = index.chunks[i]!;
    if (chunk === -1) {
      return reader.peek(position, length);
    }
    // Each reader keeps its current chunk itself, so it survives eviction from the shared cache
    let records = reader.chunk?.index === chunk ? reader.chunk.records : undefined;
    if (!records) {
      records = this.#cachedRecords(chunk);
      if (records) {
        reader.chunk = { index: chunk, records };
      }
    }
    return records?.subarray(position, position + length);
  }

  /** The record of message `i`; `readUntil` says how far past it to read into the window */
  async #loadRecord(
    i: number,
    reader: WindowedReader,
    readUntil?: (from: number) => number,
  ): Promise<Uint8Array> {
    const index = this.#index!;
    const position = index.positions[i]!;
    const length = index.lengths[i]!;
    const chunk = index.chunks[i]!;
    if (chunk === -1) {
      return await reader.read(position, length, readUntil);
    }
    const records = await this.#chunkRecords(chunk, reader.readOptions);
    reader.chunk = { index: chunk, records };
    return records.subarray(position, position + length);
  }

  #messageEvent(i: number, record: Uint8Array): MessageEvent<Uint8Array> {
    const index = this.#index!;
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength);
    const info = this.#channelInfoById.get(index.channels[i]!)!;
    // A copy: the event's buffer is transferred to the main thread, which detaches it
    const message = record.slice(MESSAGE_DATA_AT);
    const chunk = index.chunks[i]!;
    const position = index.positions[i]!;
    return {
      topic: info.channel.topic,
      receiveTime: fromNanoSec(index.logTimes[i]!),
      publishTime: fromNanoSec(view.getBigUint64(MESSAGE_PUBLISH_TIME_AT, true)),
      message,
      sizeInBytes: message.byteLength,
      schemaName: info.schemaName ?? "",
      ...(this.#options.recordIdPrefix != undefined && {
        recordId: `${this.#options.recordIdPrefix}:${chunk === -1 ? "record" : this.#chunkOffsets[chunk]}:${position}`,
      }),
    };
  }

  #cachedRecords(i: number): Uint8Array | undefined {
    const view = this.#chunkCache.get(BigInt(this.#chunkOffsets[i]!));
    return view && new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }

  async #chunkRecords(i: number, readOptions?: ReadOptions): Promise<Uint8Array> {
    const cached = this.#cachedRecords(i);
    if (cached) {
      return cached;
    }
    // Concurrent readers (playback, backfill) share one load, so a chunk is read and counted once.
    // A cancellable read joins a shared load but loads alone, so its abort can't fail other readers.
    const shared = this.#chunkLoads.get(i);
    if (shared) {
      return await abortable(shared, readOptions?.signal);
    }
    if (readOptions?.signal) {
      return await this.#loadChunk(i, readOptions);
    }
    const load = this.#loadChunk(i).finally(() => this.#chunkLoads.delete(i));
    this.#chunkLoads.set(i, load);
    return await load;
  }

  async #loadChunk(i: number, readOptions?: ReadOptions): Promise<Uint8Array> {
    const bytes = await this.#options.readable.read(
      BigInt(this.#chunkOffsets[i]!),
      BigInt(this.#chunkLengths[i]!),
      readOptions,
    );
    const chunk = parseRecord(byteReader(bytes), true);
    if (chunk?.type !== "Chunk") {
      throw new Error(`Chunk at offset ${this.#chunkOffsets[i]} changed since it was read`);
    }
    const records = decompress(this.#decompressHandlers!, chunk);
    this.#chunkCache.set(
      BigInt(this.#chunkOffsets[i]!),
      new DataView(records.buffer, records.byteOffset, records.byteLength),
    );
    return records;
  }
}

/** Collects the message index during the scan, growing its columns by doubling */
class IndexBuilder {
  public count = 0;
  #capacity = 1024;
  #logTimes = new BigUint64Array(this.#capacity);
  #positions = new Float64Array(this.#capacity);
  #lengths = new Uint32Array(this.#capacity);
  #chunks = new Int32Array(this.#capacity);
  #channels = new Uint16Array(this.#capacity);
  #sorted = true;

  /** A message record at `at` in `view`, `length` bytes long */
  public add(view: DataView, at: number, length: number, chunk: number, position: number): void {
    if (length < MESSAGE_DATA_AT || length > 0xffffffff) {
      throw new Error("Message record has an invalid length");
    }
    if (this.count === this.#capacity) {
      this.#resize(this.#capacity * 2);
    }
    const n = this.count++;
    const logTime = view.getBigUint64(at + MESSAGE_LOG_TIME_AT, true);
    if (n > 0 && logTime < this.#logTimes[n - 1]!) {
      this.#sorted = false;
    }
    this.#logTimes[n] = logTime;
    this.#positions[n] = position;
    this.#lengths[n] = length;
    this.#chunks[n] = chunk;
    this.#channels[n] = view.getUint16(at + RECORD_PREFIX_BYTES, true);
  }

  /**
   * The index sorted by log time (file order for equal times), without messages on channels that
   * `known` rejects; those are counted per channel in `orphans`.
   */
  public finish(known: (channelId: number) => boolean): {
    index: MessageIndex;
    orphans: Map<number, number>;
  } {
    const orphans = new Map<number, number>();
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const channelId = this.#channels[i]!;
      if (known(channelId)) {
        kept++;
      } else {
        orphans.set(channelId, (orphans.get(channelId) ?? 0) + 1);
      }
    }
    if (kept === this.count && this.#sorted) {
      this.#resize(this.count);
    } else {
      const order = new Uint32Array(kept);
      for (let i = 0, k = 0; i < this.count; i++) {
        if (!orphans.has(this.#channels[i]!)) {
          order[k++] = i;
        }
      }
      if (!this.#sorted) {
        // ponytail: comparator sort, a few seconds for tens of millions of out-of-order messages
        const logTimes = this.#logTimes;
        order.sort((a, b) =>
          logTimes[a]! < logTimes[b]! ? -1 : logTimes[a]! > logTimes[b]! ? 1 : a - b,
        );
      }
      this.#logTimes = gather(this.#logTimes, order, new BigUint64Array(kept));
      this.#positions = gather(this.#positions, order, new Float64Array(kept));
      this.#lengths = gather(this.#lengths, order, new Uint32Array(kept));
      this.#chunks = gather(this.#chunks, order, new Int32Array(kept));
      this.#channels = gather(this.#channels, order, new Uint16Array(kept));
      this.count = this.#capacity = kept;
    }
    return {
      index: {
        count: this.count,
        logTimes: this.#logTimes,
        positions: this.#positions,
        lengths: this.#lengths,
        chunks: this.#chunks,
        channels: this.#channels,
      },
      orphans,
    };
  }

  #resize(capacity: number): void {
    const resize = <
      T extends BigUint64Array | Float64Array | Uint32Array | Int32Array | Uint16Array,
    >(
      from: T,
      to: T,
    ): T => {
      to.set(from.subarray(0, this.count) as never);
      return to;
    };
    this.#logTimes = resize(this.#logTimes, new BigUint64Array(capacity));
    this.#positions = resize(this.#positions, new Float64Array(capacity));
    this.#lengths = resize(this.#lengths, new Uint32Array(capacity));
    this.#chunks = resize(this.#chunks, new Int32Array(capacity));
    this.#channels = resize(this.#channels, new Uint16Array(capacity));
    this.#capacity = capacity;
  }
}

function gather<T extends BigUint64Array | Float64Array | Uint32Array | Int32Array | Uint16Array>(
  from: T,
  order: Uint32Array,
  to: T,
): T {
  for (let k = 0; k < order.length; k++) {
    to[k] = from[order[k]!]!;
  }
  return to;
}

/** Reads through one buffered window, so nearby records don't each cost a read of the readable */
class WindowedReader {
  #readable: McapTypes.IReadable<ReadOptions>;
  public readonly readOptions?: ReadOptions;
  #size: number;
  #buffered?: { offset: number; bytes: Uint8Array };
  /** The decompressed chunk this reader is in */
  public chunk?: { index: number; records: Uint8Array };

  public constructor(
    readable: McapTypes.IReadable<ReadOptions>,
    size: number,
    readOptions?: ReadOptions,
  ) {
    this.#readable = readable;
    this.#size = size;
    this.readOptions = readOptions;
  }

  /** `length` bytes at `offset` if they are in the window */
  public peek(offset: number, length: number): Uint8Array | undefined {
    const buffered = this.#buffered;
    if (
      !buffered ||
      offset < buffered.offset ||
      offset + length > buffered.offset + buffered.bytes.byteLength
    ) {
      return undefined;
    }
    const at = offset - buffered.offset;
    return buffered.bytes.subarray(at, at + length);
  }

  /** `length` bytes at `offset`; on a miss the window is read from `offset` up to `until` */
  public async read(
    offset: number,
    length: number,
    until?: number | ((offset: number) => number),
  ): Promise<Uint8Array> {
    const hit = this.peek(offset, length);
    if (hit) {
      return hit;
    }
    const readUntil = typeof until === "function" ? until(offset) : (until ?? 0);
    const end = Math.min(this.#size, Math.max(offset + length, readUntil));
    const bytes = await this.#readable.read(BigInt(offset), BigInt(end - offset), this.readOptions);
    if (bytes.byteLength < length) {
      throw new Error(`Read ${bytes.byteLength} bytes at ${offset}, expected ${length}`);
    }
    this.#buffered = { offset, bytes };
    return bytes.subarray(0, length);
  }
}

/** Read only the attachment's header; the payload can be several gigabytes. */
async function readAttachmentInfo(
  reader: WindowedReader,
  offset: number,
  length: number,
): Promise<RecordingFileInfo["attachments"][number] | undefined> {
  const nameLengthAt = RECORD_PREFIX_BYTES + 16; // log time and create time
  const nameAt = nameLengthAt + 4;
  const trailerBytes = 8 + 4; // data size and CRC
  // File-provided string lengths must not turn reading the header into a payload-sized transfer.
  const headerLimit = Math.min(length, READ_WINDOW_BYTES);
  if (headerLimit < nameAt + 4 + trailerBytes) {
    return undefined;
  }
  const nameLength = byteReader(await reader.read(offset + nameLengthAt, 4)).uint32();
  if (nameAt + nameLength + 4 + trailerBytes > headerLimit) {
    return undefined;
  }
  const nameHeader = byteReader(await reader.read(offset + nameLengthAt, 4 + nameLength + 4));
  const name = nameHeader.string();
  const mediaTypeLength = nameHeader.uint32();
  const mediaTypeAt = nameAt + nameLength + 4;
  if (mediaTypeAt + mediaTypeLength + trailerBytes > headerLimit) {
    return undefined;
  }
  const mediaHeader = byteReader(
    await reader.read(offset + mediaTypeAt - 4, 4 + mediaTypeLength + 8),
  );
  const mediaType = mediaHeader.string();
  const sizeBytes = Number(mediaHeader.uint64());
  if (sizeBytes > length - mediaTypeAt - mediaTypeLength - trailerBytes) {
    return undefined;
  }
  return { offset, name, mediaType, sizeBytes };
}

/** First message at or after `time` */
function lowerBound(index: MessageIndex, time: bigint): number {
  let low = 0;
  let high = index.count;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (index.logTimes[mid]! < time) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

/** End of the record at `at`; throws if it runs past the end */
function recordEnd(view: DataView, at: number): number {
  if (at + RECORD_PREFIX_BYTES > view.byteLength) {
    throw new Error("Chunk ends in the middle of a record");
  }
  const end = at + RECORD_PREFIX_BYTES + Number(view.getBigUint64(at + 1, true));
  if (end > view.byteLength) {
    throw new Error("Chunk ends in the middle of a record");
  }
  return end;
}

function decompress(handlers: McapTypes.DecompressHandlers, chunk: McapTypes.Chunk): Uint8Array {
  let records = chunk.records;
  // An empty chunk has nothing to decompress (as in McapIndexedReader and McapStreamReader)
  if (chunk.compression !== "" && chunk.records.byteLength > 0) {
    const handler = handlers[chunk.compression];
    if (!handler) {
      throw new Error(`Unsupported compression ${chunk.compression}`);
    }
    records = handler(chunk.records, chunk.uncompressedSize);
  }
  if (chunk.uncompressedCrc !== 0 && crc32(records) !== chunk.uncompressedCrc) {
    throw new Error("Chunk CRC mismatch");
  }
  return records;
}

function byteReader(bytes: Uint8Array): McapByteReader {
  return new McapByteReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

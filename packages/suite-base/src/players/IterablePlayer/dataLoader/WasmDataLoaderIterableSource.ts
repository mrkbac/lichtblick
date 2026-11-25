// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, fromNanoSec, toNanoSec } from "@foxglove/rostime";

import Logger from "@lichtblick/log";
import { parseChannel } from "@lichtblick/mcap-support";
import { MessageEvent, TopicStats } from "@lichtblick/suite-base/players/types";
import { RosDatatypes } from "@lichtblick/suite-base/types/RosDatatypes";
import { toError } from "@lichtblick/suite-base/util/toError";

import {
  GetBackfillMessagesArgs,
  ISerializedIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
  TopicWithDecodingInfo,
} from "../IIterableSource";
import { LoaderMessage, SyncFile, WasmDataLoader } from "./WasmDataLoader";

const log = Logger.getLogger(__filename);

/** Plays files through a data loader extension's WebAssembly module (see WasmDataLoader). */
export class WasmDataLoaderIterableSource implements ISerializedIterableSource {
  public readonly sourceType = "serialized";

  readonly #wasm: BufferSource | WebAssembly.Module;
  readonly #files: ReadonlyMap<string, SyncFile>;
  #loader: WasmDataLoader | undefined;
  readonly #channels = new Map<number, { topic: string; schemaName: string }>();
  readonly #channelIdsByTopic = new Map<string, number[]>();

  public constructor(
    wasm: BufferSource | WebAssembly.Module,
    files: ReadonlyMap<string, SyncFile>,
  ) {
    this.#wasm = wasm;
    this.#files = files;
  }

  public async initialize(): Promise<Initialization> {
    this.#loader = await WasmDataLoader.create(this.#wasm, this.#files, log);
    const init = this.#loader.initialize();
    const alerts: Initialization["alerts"] = [...init.problems];

    const schemas = new Map(init.schemas.map((schema) => [schema.id, schema]));
    const topics = new Map<string, TopicWithDecodingInfo>();
    const topicStats = new Map<string, TopicStats>();
    const datatypes: RosDatatypes = new Map();
    const publishersByTopic: Initialization["publishersByTopic"] = new Map();
    for (const channel of init.channels) {
      const schema = channel.schemaId == undefined ? undefined : schemas.get(channel.schemaId);
      try {
        const parsed = parseChannel({
          messageEncoding: channel.messageEncoding,
          schema,
        });
        for (const [name, datatype] of parsed.datatypes) {
          datatypes.set(name, datatype);
        }
      } catch (error) {
        alerts.push({
          severity: "error",
          message: `Error in topic ${channel.topicName} (channel ${channel.id}): ${toError(error).message}`,
          error: toError(error),
        });
        continue;
      }
      const topic = channel.topicName;
      this.#channels.set(channel.id, { topic, schemaName: schema?.name ?? "" });
      const channelIds = this.#channelIdsByTopic.get(topic) ?? [];
      this.#channelIdsByTopic.set(topic, channelIds);
      channelIds.push(channel.id);
      const publishers = publishersByTopic.get(topic) ?? new Set();
      publishersByTopic.set(topic, publishers);
      publishers.add(String(channel.id));
      if (!topics.has(topic)) {
        topics.set(topic, {
          name: topic,
          schemaName: schema?.name,
          messageEncoding: channel.messageEncoding,
          schemaData: schema?.data,
          schemaEncoding: schema?.encoding,
        });
      }
      if (channel.messageCount != undefined) {
        const numMessages =
          (topicStats.get(topic)?.numMessages ?? 0) + Number(channel.messageCount);
        topicStats.set(topic, { numMessages });
      }
    }

    return {
      start: fromNanoSec(init.startTime),
      end: fromNanoSec(init.endTime),
      topics: [...topics.values()],
      topicStats,
      datatypes,
      profile: undefined,
      alerts,
      publishersByTopic,
    };
  }

  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<Readonly<IteratorResult<Uint8Array>>> {
    const channels = this.#channelIds(args.topics.keys());
    if (channels.length === 0) {
      return;
    }
    for (const message of this.#getLoader().messages({
      channels,
      start: args.start && toNanoSec(args.start),
      end: args.end && toNanoSec(args.end),
    })) {
      args.abort?.throwIfAborted();
      yield { type: "message-event", msgEvent: this.#messageEvent(message) };
    }
  }

  public async getBackfillMessages(
    args: GetBackfillMessagesArgs,
  ): Promise<MessageEvent<Uint8Array>[]> {
    const channels = this.#channelIds(args.topics.keys());
    if (channels.length === 0) {
      return [];
    }
    return this.#getLoader()
      .backfill(toNanoSec(args.time), channels)
      .map((message) => this.#messageEvent(message))
      .sort((a, b) => compare(a.receiveTime, b.receiveTime));
  }

  #getLoader(): WasmDataLoader {
    if (!this.#loader) {
      throw new Error("Data loader is not initialized");
    }
    return this.#loader;
  }

  #channelIds(topics: Iterable<string>): number[] {
    return [...topics].flatMap((topic) => this.#channelIdsByTopic.get(topic) ?? []);
  }

  #messageEvent(message: LoaderMessage): MessageEvent<Uint8Array> {
    const channel = this.#channels.get(message.channelId);
    if (!channel) {
      throw new Error(`Data loader returned a message on unknown channel ${message.channelId}`);
    }
    return {
      topic: channel.topic,
      receiveTime: fromNanoSec(message.logTime),
      publishTime: fromNanoSec(message.publishTime),
      message: message.data,
      sizeInBytes: message.data.byteLength,
      schemaName: channel.schemaName,
    };
  }
}

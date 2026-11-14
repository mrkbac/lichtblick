// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time, fromNanoSec, toNanoSec } from "@foxglove/rostime";

import { Immutable, MessageEvent } from "@lichtblick/suite";
import { TopicSelection, TopicStats } from "@lichtblick/suite-base/players/types";

import {
  GetBackfillMessagesArgs,
  IIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "../IIterableSource";

/** Topic prefix label for the n-th compared recording: a, b, c, … */
export function compareLabel(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : `r${index + 1}`;
}

export function prefixTopic(prefix: string, topic: string): string {
  return topic.startsWith("/") ? `${prefix}${topic}` : `${prefix}/${topic}`;
}

/**
 * One recording in a comparison: puts its topics under `prefix` (e.g. `/a/imu`) and shifts its
 * times by a fixed offset so several recordings can share one timeline side by side.
 */
export class ComparedSource<MessageType = Uint8Array> implements IIterableSource<MessageType> {
  readonly #source: IIterableSource<MessageType>;
  readonly #prefix: string;
  #offsetNs = 0n;
  // Prefixed topic name -> name in the recording
  readonly #originalTopic = new Map<string, string>();
  #init?: Initialization;

  public constructor(source: IIterableSource<MessageType>, prefix: string) {
    this.#source = source;
    this.#prefix = prefix;
  }

  public async initialize(): Promise<Initialization> {
    this.#init = await this.#source.initialize();
    return this.#mapInit(this.#init);
  }

  /** Shift this recording so it starts at `start`; returns the shifted initialization. */
  public alignStartTo(start: Time): Initialization {
    if (!this.#init) {
      throw new Error("alignStartTo called before initialize");
    }
    this.#offsetNs = toNanoSec(start) - toNanoSec(this.#init.start);
    return this.#mapInit(this.#init);
  }

  public async *messageIterator(
    args: Immutable<MessageIteratorArgs>,
  ): AsyncIterableIterator<Readonly<IteratorResult<MessageType>>> {
    const topics = this.#unprefixSelection(args.topics as TopicSelection);
    if (topics.size === 0) {
      return;
    }
    const iterator = this.#source.messageIterator({
      ...args,
      topics,
      start: args.start && this.#shift(args.start, -1n),
      end: args.end && this.#shift(args.end, -1n),
    });
    try {
      for (;;) {
        const result = await iterator.next();
        if (result.done === true) {
          return;
        }
        const value = result.value;
        if (value.type === "message-event") {
          yield { type: "message-event", msgEvent: this.#mapEvent(value.msgEvent) };
        } else if (value.type === "stamp") {
          yield { type: "stamp", stamp: this.#shift(value.stamp) };
        } else {
          yield value;
        }
      }
    } finally {
      await iterator.return?.();
    }
  }

  public async getBackfillMessages(
    args: Immutable<GetBackfillMessagesArgs>,
  ): Promise<MessageEvent<MessageType>[]> {
    const topics = this.#unprefixSelection(args.topics as TopicSelection);
    if (topics.size === 0) {
      return [];
    }
    const messages = await this.#source.getBackfillMessages({
      ...args,
      topics,
      time: this.#shift(args.time, -1n),
    });
    return messages.map((event) => this.#mapEvent(event));
  }

  public getStart = (): Time | undefined => {
    const start = this.#source.getStart?.();
    return start && this.#shift(start);
  };

  public getEnd = (): Time | undefined => {
    const end = this.#source.getEnd?.();
    return end && this.#shift(end);
  };

  public async terminate(): Promise<void> {
    await this.#source.terminate?.();
  }

  public async prewarm(): Promise<void> {
    await this.#source.prewarm?.();
  }

  // Times can't go below zero, so a range that starts before the shifted recording clamps to 0.
  #shift(time: Time, sign = 1n): Time {
    const ns = toNanoSec(time) + sign * this.#offsetNs;
    return fromNanoSec(ns < 0n ? 0n : ns);
  }

  #prefixed(topic: string): string {
    const name = prefixTopic(this.#prefix, topic);
    this.#originalTopic.set(name, topic);
    return name;
  }

  #unprefixSelection(topics: TopicSelection): TopicSelection {
    const result: TopicSelection = new Map();
    for (const [name, payload] of topics) {
      const original = this.#originalTopic.get(name);
      if (original != undefined) {
        result.set(original, { ...payload, topic: original });
      }
    }
    return result;
  }

  #mapEvent(event: MessageEvent<MessageType>): MessageEvent<MessageType> {
    return {
      ...event,
      topic: this.#prefixed(event.topic),
      receiveTime: this.#shift(event.receiveTime),
      publishTime: event.publishTime && this.#shift(event.publishTime),
    };
  }

  #mapInit(init: Initialization): Initialization {
    const topicStats = new Map<string, TopicStats>();
    for (const [topic, stats] of init.topicStats) {
      topicStats.set(this.#prefixed(topic), {
        ...stats,
        firstMessageTime: stats.firstMessageTime && this.#shift(stats.firstMessageTime),
        lastMessageTime: stats.lastMessageTime && this.#shift(stats.lastMessageTime),
      });
    }
    return {
      ...init,
      start: this.#shift(init.start),
      end: this.#shift(init.end),
      topics: init.topics.map((topic) => ({ ...topic, name: this.#prefixed(topic.name) })),
      topicStats,
      publishersByTopic: new Map(
        [...init.publishersByTopic].map(([topic, ids]) => [this.#prefixed(topic), ids]),
      ),
      recordingFiles: init.recordingFiles?.map((file) => ({
        ...file,
        topicPrefix: this.#prefix,
        start: file.start && this.#shift(file.start),
        end: file.end && this.#shift(file.end),
        channels: file.channels.map((channel) => ({
          ...channel,
          topic: this.#prefixed(channel.topic),
        })),
      })),
    };
  }
}

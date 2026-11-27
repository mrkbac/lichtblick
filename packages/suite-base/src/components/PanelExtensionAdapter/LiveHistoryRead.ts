// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { compare, Time } from "@foxglove/rostime";

import { pushAll } from "@lichtblick/den/collection";
import { MessageEvent } from "@lichtblick/suite";

/** Each message to use now from a live frame: topics whose history is read wait (see live()) */
export function takeLive<T extends Pick<MessageEvent, "topic" | "receiveTime">>(
  messages: readonly T[],
  reads: ReadonlyMap<string, LiveHistoryRead<T>>,
): T[] {
  if (reads.size === 0) {
    return [...messages];
  }
  const now: T[] = [];
  for (const [topic, ofTopic] of Map.groupBy(messages, (message) => message.topic)) {
    pushAll(now, reads.get(topic)?.live(ofTopic) ?? ofTopic);
  }
  return now;
}

/**
 * Joins a read of a live session's history (BuiltinRangeOptions.liveHistory) with the live frames
 * of the same topic, so each message is used exactly once: frames that arrive while the history is
 * read wait, and once it ends only the ones after the history go on.
 */
export class LiveHistoryRead<T extends Pick<MessageEvent, "receiveTime"> = MessageEvent> {
  /** Frames received during the read; undefined once it ended */
  #waiting: T[] | undefined = [];
  /** The newest message of the history read */
  #newest?: Time;

  /** Note a batch of the history read */
  public read(batch: readonly Pick<MessageEvent, "receiveTime">[]): void {
    for (const { receiveTime } of batch) {
      if (!this.#newest || compare(receiveTime, this.#newest) > 0) {
        this.#newest = receiveTime;
      }
    }
  }

  /** A live frame's messages of the topic: what to use now (nothing while the history is read) */
  public live(messages: readonly T[]): readonly T[] {
    if (!this.#waiting) {
      return messages;
    }
    pushAll(this.#waiting, messages);
    return [];
  }

  /** The history read ended: the frames that waited and came after it, to use now */
  public end(): T[] {
    const newest = this.#newest;
    const after = (this.#waiting ?? []).filter(
      ({ receiveTime }) => !newest || compare(receiveTime, newest) > 0,
    );
    this.#waiting = undefined;
    return after;
  }
}

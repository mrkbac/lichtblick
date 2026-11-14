// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { Time } from "@foxglove/rostime";

import { MessageEvent } from "@lichtblick/suite";

import {
  IIterableSource,
  Initialization,
  IteratorResult,
  MessageIteratorArgs,
} from "../IIterableSource";
import { ComparedSource, compareLabel, prefixTopic } from "./ComparedSource";
import { MultiIterableSource } from "./MultiIterableSource";

// A recording with one message per second on /imu, starting at `startSec`
class FakeSource implements IIterableSource<Uint8Array> {
  public readonly sourceType = "serialized";
  public lastArgs?: MessageIteratorArgs;
  readonly #start: Time;
  public constructor({ file }: { file: { startSec: number } }) {
    this.#start = { sec: file.startSec, nsec: 0 };
  }
  #event(sec: number): MessageEvent<Uint8Array> {
    return {
      topic: "/imu",
      schemaName: "Imu",
      receiveTime: { sec, nsec: 0 },
      message: new Uint8Array(),
      sizeInBytes: 0,
    };
  }
  public async initialize(): Promise<Initialization> {
    return {
      start: this.#start,
      end: { sec: this.#start.sec + 2, nsec: 0 },
      topics: [{ name: "/imu", schemaName: "Imu" }],
      topicStats: new Map([["/imu", { numMessages: 3 }]]),
      datatypes: new Map(),
      profile: undefined,
      publishersByTopic: new Map(),
      alerts: [],
    };
  }
  public async *messageIterator(
    args: MessageIteratorArgs,
  ): AsyncIterableIterator<IteratorResult<Uint8Array>> {
    this.lastArgs = args;
    for (let sec = this.#start.sec; sec <= this.#start.sec + 2; sec++) {
      yield { type: "message-event", msgEvent: this.#event(sec) };
    }
  }
  public async getBackfillMessages(): Promise<MessageEvent<Uint8Array>[]> {
    return [this.#event(this.#start.sec)];
  }
  public getStart = (): Time => this.#start;
  public getEnd = (): Time => ({ sec: this.#start.sec + 2, nsec: 0 });
}

describe("compared recordings", () => {
  it("prefixes topics and aligns every recording to the earliest start", async () => {
    const source = new MultiIterableSource(
      {
        type: "files",
        files: [{ startSec: 100 }, { startSec: 500 }] as unknown as Blob[],
        compare: true,
      },
      FakeSource,
    );
    const init = await source.initialize();
    expect(init.topics.map((topic) => topic.name).sort()).toEqual(["/a/imu", "/b/imu"]);
    expect(init.start).toEqual({ sec: 100, nsec: 0 });
    expect(init.end).toEqual({ sec: 102, nsec: 0 });

    const results = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/b/imu", { topic: "/b/imu" }]]),
    })) {
      results.push(result);
    }
    // Only /b was asked for; its messages at 500..502 are shifted to 100..102
    expect(
      results.map((r) =>
        r.type === "message-event" ? [r.msgEvent.topic, r.msgEvent.receiveTime.sec] : r,
      ),
    ).toEqual([
      ["/b/imu", 100],
      ["/b/imu", 101],
      ["/b/imu", 102],
    ]);
  });

  it("maps requested times back into the recording's own clock", async () => {
    const inner = new FakeSource({ file: { startSec: 500 } });
    const compared = new ComparedSource(inner, "/b");
    await compared.initialize();
    compared.alignStartTo({ sec: 100, nsec: 0 });

    const iterator = compared.messageIterator({
      topics: new Map([["/b/imu", { topic: "/b/imu" }]]),
      start: { sec: 101, nsec: 0 },
      end: { sec: 50, nsec: 0 },
    });
    await iterator.next();
    expect(inner.lastArgs?.topics).toEqual(new Map([["/imu", { topic: "/imu" }]]));
    expect(inner.lastArgs?.start).toEqual({ sec: 501, nsec: 0 });

    const backfill = await compared.getBackfillMessages({
      topics: new Map([["/b/imu", { topic: "/b/imu" }]]),
      time: { sec: 101, nsec: 0 },
    });
    expect(backfill.map((event) => [event.topic, event.receiveTime.sec])).toEqual([
      ["/b/imu", 100],
    ]);
  });

  it("labels recordings a…z, then r27…, and prefixes topics with or without a leading slash", () => {
    expect([0, 1, 25, 26].map(compareLabel)).toEqual(["a", "b", "z", "r27"]);
    expect(prefixTopic("/a", "/imu")).toEqual("/a/imu");
    expect(prefixTopic("/a", "imu")).toEqual("/a/imu");
  });
});

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
  public waitForUpdate?: () => Promise<Initialization | undefined>;
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
        compare: ["run 1", "run 2"],
      },
      FakeSource,
    );
    const init = await source.initialize();
    expect(init.topics.map((topic) => topic.name).sort()).toEqual(["/a/imu", "/b/imu"]);
    expect(init.start).toEqual({ sec: 100, nsec: 0 });
    expect(init.end).toEqual({ sec: 102, nsec: 0 });
    expect(init.compareSides).toEqual([
      {
        prefix: "/a",
        name: "run 1",
        start: { sec: 100, nsec: 0 },
        end: { sec: 102, nsec: 0 },
        sharedStart: { sec: 100, nsec: 0 },
        offsetSec: 0,
      },
      {
        prefix: "/b",
        name: "run 2",
        start: { sec: 500, nsec: 0 },
        end: { sec: 502, nsec: 0 },
        sharedStart: { sec: 100, nsec: 0 },
        offsetSec: 0,
      },
    ]);

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

  it("keeps `imu` and `/imu` apart after prefixing", async () => {
    const inner = new FakeSource({ file: { startSec: 0 } });
    const init = await inner.initialize();
    inner.initialize = async () => ({
      ...init,
      // Discovery order must not matter: `imu` gets the suffix either way
      topics: [
        { name: "imu", schemaName: "Imu" },
        { name: "/imu", schemaName: "Imu" },
      ],
    });
    const compared = new ComparedSource(inner, "/a");
    const result = await compared.initialize();
    expect(result.topics.map((topic) => topic.name)).toEqual(["/a/imu (2)", "/a/imu"]);

    const iterator = compared.messageIterator({
      topics: new Map([["/a/imu (2)", { topic: "/a/imu (2)" }]]),
    });
    await iterator.next();
    expect(inner.lastArgs?.topics).toEqual(new Map([["imu", { topic: "imu" }]]));
  });

  it("merges the files of one side, e.g. one folder, before comparing the sides", async () => {
    const source = new MultiIterableSource(
      {
        type: "files",
        files: [{ startSec: 100 }, { startSec: 500 }, { startSec: 103 }] as unknown as Blob[],
        compare: ["folder a", "folder b", "folder a"],
      },
      FakeSource,
    );
    const init = await source.initialize();
    expect(
      init.compareSides?.map((side) => [side.prefix, side.name, side.start.sec, side.end.sec]),
    ).toEqual([
      ["/a", "folder a", 100, 105],
      ["/b", "folder b", 500, 502],
    ]);

    const seconds = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/a/imu", { topic: "/a/imu" }]]),
    })) {
      if (result.type === "message-event") {
        seconds.push(result.msgEvent.receiveTime.sec);
      }
    }
    expect(seconds).toEqual([100, 101, 102, 103, 104, 105]);
  });

  it("moves a side by its offset and reports it as an update of every message", async () => {
    const source = new MultiIterableSource(
      {
        type: "files",
        files: [{ startSec: 100 }, { startSec: 500 }] as unknown as Blob[],
        compare: ["a", "b"],
      },
      FakeSource,
    );
    await source.initialize();
    // A comparison keeps updating, so it reports moved sides at any time
    const update = source.waitForUpdate();
    await source.setCompareOffsets([0, 2.5]);
    const init = await update;

    expect(init?.updatedRanges).toBeUndefined();
    expect(init?.end).toEqual({ sec: 104, nsec: 500_000_000 });
    expect(init?.compareSides?.[1]).toMatchObject({
      sharedStart: { sec: 102, nsec: 500_000_000 },
      offsetSec: 2.5,
    });

    const times = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/b/imu", { topic: "/b/imu" }]]),
    })) {
      if (result.type === "message-event") {
        times.push(result.msgEvent.receiveTime);
      }
    }
    expect(times[0]).toEqual({ sec: 102, nsec: 500_000_000 });
  });

  it("keeps names given out when an update finds a topic that would collide", async () => {
    const inner = new FakeSource({ file: { startSec: 0 } });
    const init = await inner.initialize();
    inner.initialize = async () => ({
      ...init,
      topics: [{ name: "imu", schemaName: "Imu" }],
      topicStats: new Map(),
    });
    let resolveUpdate: (update: Initialization) => void = () => {};
    inner.waitForUpdate = async () =>
      await new Promise<Initialization>((resolve) => {
        resolveUpdate = resolve;
      });
    const compared = new ComparedSource(inner, "/a");
    expect((await compared.initialize()).topics.map((topic) => topic.name)).toEqual(["/a/imu"]);

    const update = compared.waitForUpdate!();
    resolveUpdate({
      ...init,
      topicStats: new Map(),
      topics: [
        { name: "imu", schemaName: "Imu" },
        { name: "/imu", schemaName: "Imu" },
      ],
    });
    expect((await update)?.topics.map((topic) => topic.name)).toEqual(["/a/imu", "/a/imu (2)"]);
  });

  it("moves every side later instead of below time zero", async () => {
    const source = new MultiIterableSource(
      {
        type: "files",
        files: [{ startSec: 0 }, { startSec: 500 }] as unknown as Blob[],
        compare: ["a", "b"],
      },
      FakeSource,
    );
    await source.initialize();
    const update = source.waitForUpdate();
    await source.setCompareOffsets([0, -1]);
    const init = await update;
    expect(init?.compareSides?.map((side) => side.sharedStart.sec)).toEqual([1, 0]);

    const seconds = [];
    for await (const result of source.messageIterator({
      topics: new Map([["/b/imu", { topic: "/b/imu" }]]),
      start: { sec: 0, nsec: 0 },
    })) {
      if (result.type === "message-event") {
        seconds.push(result.msgEvent.receiveTime.sec);
      }
    }
    expect(seconds).toEqual([0, 1, 2]);
  });
});

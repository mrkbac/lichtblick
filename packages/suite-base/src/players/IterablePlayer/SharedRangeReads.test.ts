// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";
import { TopicSelection } from "@lichtblick/suite-base/players/types";

import { IteratorResult } from "./IIterableSource";
import { SharedRangeReads } from "./SharedRangeReads";

function message(topic: string, sec: number): MessageEvent {
  return {
    topic,
    receiveTime: { sec, nsec: 0 },
    message: undefined,
    sizeInBytes: 1,
    schemaName: "s",
  };
}

const messages = [0, 1, 2, 3].flatMap((sec) => ["a", "b", "c"].map((topic) => message(topic, sec)));

function setup() {
  const reads: TopicSelection[] = [];
  const shared = new SharedRangeReads(async function* (topics) {
    reads.push(topics);
    for (const msgEvent of messages) {
      if (topics.has(msgEvent.topic)) {
        yield { type: "message-event", msgEvent };
      }
    }
  });
  return { shared, reads };
}

async function collect(iterator: AsyncIterableIterator<Readonly<IteratorResult>>) {
  const topics: string[] = [];
  for await (const result of iterator) {
    if (result.type === "message-event") {
      topics.push(`${result.msgEvent.topic}${result.msgEvent.receiveTime.sec}`);
    }
  }
  return topics;
}

describe("SharedRangeReads", () => {
  it("reads topics requested together over the same range in one pass", async () => {
    const { shared, reads } = setup();

    const [a, b, alsoA] = await Promise.all([
      collect(shared.read("a", {})),
      collect(shared.read("b", {})),
      collect(shared.read("a", {})),
    ]);

    expect(reads.map((topics) => [...topics.keys()])).toEqual([["a", "b"]]);
    expect(a).toEqual(["a0", "a1", "a2", "a3"]);
    expect(alsoA).toEqual(a);
    expect(b).toEqual(["b0", "b1", "b2", "b3"]);
  });

  it("reads other ranges separately", async () => {
    const { shared, reads } = setup();

    await Promise.all([
      collect(shared.read("a", {})),
      collect(shared.read("b", { start: { sec: 1, nsec: 0 } })),
    ]);

    expect(reads).toHaveLength(2);
  });

  it("keeps reading for the others when one reader stops", async () => {
    const { shared } = setup();
    const stopping = shared.read("a", {});
    const b = shared.read("b", {});

    expect((await stopping.next()).done).toBe(false);
    await stopping.return?.();

    expect(await collect(b)).toEqual(["b0", "b1", "b2", "b3"]);
    expect((await stopping.next()).done).toBe(true);
  });

  it("resolves overlapping pulls in order", async () => {
    const { shared } = setup();
    const reader = shared.read("a", {});
    const [first, second] = await Promise.all([reader.next(), reader.next()]);
    expect(first.value).toMatchObject({ msgEvent: { receiveTime: { sec: 0 } } });
    expect(second.value).toMatchObject({ msgEvent: { receiveTime: { sec: 1 } } });
    await reader.return?.();
  });

  it("reports an error thrown while opening the iterator", async () => {
    const shared = new SharedRangeReads(() => {
      throw new Error("open failed");
    });
    await expect(collect(shared.read("a", {}))).rejects.toThrow("open failed");
  });

  it("hands a read error to every reader", async () => {
    const shared = new SharedRangeReads(async function* () {
      yield* [];
      throw new Error("read failed");
    });

    await expect(collect(shared.read("a", {}))).rejects.toThrow("read failed");
  });
});

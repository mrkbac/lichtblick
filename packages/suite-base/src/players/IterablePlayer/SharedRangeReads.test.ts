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

  it("starts reads of part of the recording right away, on their own", async () => {
    const { shared, reads } = setup();

    const whole = collect(shared.read("a", {}));
    const partial = shared.read("b", { start: { sec: 1, nsec: 0 } });
    // Read before the whole-history read has gathered its readers
    expect((await partial.next()).done).toBe(false);
    expect(reads.map((topics) => [...topics.keys()])).toEqual([["b"]]);

    await Promise.all([whole, collect(partial)]);
    expect(reads.map((topics) => [...topics.keys()])).toEqual([["b"], ["a"]]);
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

  it("doesn't stall a consumer that merges its readers by time", async () => {
    // 5000 dense messages (more than a reader queues) before the sparse topic's first one, which
    // shares its receive time with two dense ones
    const recording = [
      ...Array.from({ length: 5000 }, (_, i) => message("dense", i)),
      message("dense", 5000),
      message("sparse", 5000),
      message("dense", 5000),
      message("sparse", 5001),
    ];
    const reads: string[][] = [];
    const shared = new SharedRangeReads(async function* (topics, range) {
      reads.push([...topics.keys()]);
      for (const msgEvent of recording) {
        if (
          topics.has(msgEvent.topic) &&
          (!range.start || msgEvent.receiveTime.sec >= range.start.sec)
        ) {
          yield { type: "message-event", msgEvent };
        }
      }
    });
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});

    // Like a merge by time: the first message of every input before any further one
    const firstDense = dense.next();
    const firstSparse = await sparse.next();
    expect((await firstDense).done).toBe(false);

    expect(firstSparse.value).toMatchObject({ msgEvent: { topic: "sparse" } });
    expect(await collect(sparse)).toEqual(["sparse5001"]);
    expect(await collect(dense)).toHaveLength(5001);
    expect(reads).toEqual([["dense", "sparse"], ["sparse"]]);
  });

  it("goes on without an iterator that is never read", async () => {
    // More messages for the unread topic than a reader queues
    const recording = Array.from({ length: 5000 }, (_, i) => [
      message("a", i),
      message("b", i),
    ]).flat();
    const shared = new SharedRangeReads(async function* (topics) {
      for (const msgEvent of recording) {
        if (topics.has(msgEvent.topic)) {
          yield { type: "message-event", msgEvent };
        }
      }
    });
    const neverRead = shared.read("a", {});
    const read = shared.read("b", {});

    expect(await collect(read)).toHaveLength(5000);
    await neverRead.return?.();
  });

  it("fails a waiting reader whose own read can't be opened", async () => {
    const recording = [
      ...Array.from({ length: 5000 }, (_, i) => message("dense", i)),
      message("sparse", 5000),
    ];
    const shared = new SharedRangeReads((topics) => {
      if (!topics.has("dense")) {
        throw new Error("can't open");
      }
      return (async function* () {
        for (const msgEvent of recording) {
          if (topics.has(msgEvent.topic)) {
            yield { type: "message-event" as const, msgEvent };
          }
        }
      })();
    });
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});

    void dense.next();
    await expect(sparse.next()).rejects.toThrow("can't open");
    await dense.return?.();
  });

  it("ends a waiting pull right away when a reader on its own read is closed", async () => {
    const recording = Array.from({ length: 5000 }, (_, i) => message("dense", i));
    // Its own read never delivers, like a remote read that hangs
    const hanging: AsyncIterableIterator<Readonly<IteratorResult>> = {
      next: async () => await new Promise<never>(() => {}),
      return: async () => await new Promise<never>(() => {}),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
    const shared = new SharedRangeReads((topics) =>
      topics.has("dense")
        ? (async function* () {
            for (const msgEvent of recording) {
              yield { type: "message-event" as const, msgEvent };
            }
          })()
        : hanging,
    );
    const dense = shared.read("dense", {});
    const sparse = shared.read("sparse", {});
    void dense.next();
    const pending = sparse.next();
    // Let the shared read fill up and hand "sparse" its own read
    await new Promise((resolve) => setTimeout(resolve, 50));

    await sparse.return?.();
    expect(await pending).toEqual({ done: true, value: undefined });
    await dense.return?.();
  });

  it("answers overlapping pulls in order", async () => {
    const { shared } = setup();
    const reader = shared.read("a", {});

    const results = await Promise.all([reader.next(), reader.next(), reader.next()]);
    expect(
      results.map(
        (result) => (result.value as { msgEvent: MessageEvent }).msgEvent.receiveTime.sec,
      ),
    ).toEqual([0, 1, 2]);
  });
});

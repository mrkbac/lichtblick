// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { MessageEvent } from "@lichtblick/suite";

import {
  SYNC_BYTES_PER_TOPIC,
  syncTimestamp,
  TimestampSynchronizer,
} from "./TimestampSynchronizer";

function msg(topic: string, sec: number, receiveSec = 100, sizeInBytes = 0): MessageEvent {
  return {
    topic,
    schemaName: "test",
    receiveTime: { sec: receiveSec, nsec: 0 },
    sizeInBytes,
    message: { header: { stamp: { sec, nsec: 0 }, frame_id: "" } },
  };
}

function stamps(events: readonly MessageEvent[]): string[] {
  return events.map((event) => `${event.topic}@${syncTimestamp(event)}`);
}

const S = 1_000_000_000n;

describe("syncTimestamp", () => {
  it("prefers the header stamp, then a timestamp field, then the log time", () => {
    expect(syncTimestamp(msg("a", 5))).toBe(5n * S);
    expect(syncTimestamp({ ...msg("a", 0, 9), message: { timestamp: { sec: 3, nsec: 1 } } })).toBe(
      3n * S + 1n,
    );
    expect(
      syncTimestamp({
        ...msg("a", 0, 9),
        message: { entities: [{ timestamp: { sec: 4, nsec: 0 } }] },
      }),
    ).toBe(4n * S);
    expect(syncTimestamp({ ...msg("a", 0, 9), message: { data: 1 } })).toBe(9n * S);
  });

  it("reads ROS 2 { sec, nanosec } stamps", () => {
    const ros2 = { sec: 3, nanosec: 1 };
    expect(syncTimestamp({ ...msg("a", 0, 9), message: { header: { stamp: ros2 } } })).toBe(
      3n * S + 1n,
    );
    expect(syncTimestamp({ ...msg("a", 0, 9), message: { timestamp: ros2 } })).toBe(3n * S + 1n);
  });
});

describe("TimestampSynchronizer", () => {
  it("passes everything through with fewer than two topics", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a"]));
    const events = [msg("a", 1), msg("b", 2)];
    expect(sync.filter(events)).toEqual(events);
    expect(sync.isWaiting()).toBe(false);
  });

  it("holds synced topics until their timestamps match and passes others through", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    expect(stamps(sync.filter([msg("a", 1), msg("other", 1)]))).toEqual([`other@${S}`]);
    expect(sync.isWaiting()).toBe(true);
    expect(sync.filter([msg("b", 2)])).toEqual([]);
    expect(stamps(sync.filter([msg("b", 1)]))).toEqual([`a@${S}`, `b@${S}`]);
    expect(sync.isWaiting()).toBe(false);
  });

  it("releases only the newest matching set and drops older entries", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    const out = sync.filter([msg("a", 1), msg("a", 2), msg("a", 3), msg("b", 1), msg("b", 2)]);
    expect(stamps(out)).toEqual([`a@${2n * S}`, `b@${2n * S}`]);
    // Stamp 1 was dropped, stamp 3 is still buffered
    expect(sync.filter([msg("b", 1)])).toEqual([]);
    expect(stamps(sync.filter([msg("b", 3)]))).toEqual([`a@${3n * S}`, `b@${3n * S}`]);
  });

  it("drops stamps more than the sync window behind a topic's newest", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    for (let sec = 0; sec <= 11; sec++) {
      sync.filter([msg("a", sec)]);
    }
    // 0 is 11 s behind, 1 is exactly 10 s behind and stays
    expect(sync.filter([msg("b", 0)])).toEqual([]);
    expect(stamps(sync.filter([msg("b", 1)]))).toEqual([`a@${S}`, `b@${S}`]);
  });

  it("drops the oldest stamps past the byte budget but keeps the newest", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    const third = SYNC_BYTES_PER_TOPIC / 3;
    for (let sec = 1; sec <= 4; sec++) {
      sync.filter([msg("a", sec, 100, third)]);
    }
    expect(sync.filter([msg("b", 1)])).toEqual([]);
    expect(stamps(sync.filter([msg("b", 2)]))).toEqual([`a@${2n * S}`, `b@${2n * S}`]);

    sync.filter([msg("a", 9, 100, 2 * SYNC_BYTES_PER_TOPIC)]);
    expect(stamps(sync.filter([msg("b", 9)]))).toEqual([`a@${9n * S}`, `b@${9n * S}`]);
  });

  it("releases an older set completed in the same batch when the newest is evicted by it", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    sync.filter([msg("a", 1), msg("a", 2)]);
    // b completes 1 and 2, then a@12 pushes a@1 out of the window
    const out = sync.filter([msg("b", 1), msg("b", 2), msg("a", 12)]);
    expect(stamps(out)).toEqual([`a@${2n * S}`, `b@${2n * S}`]);
  });

  it("keeps matching after one future-stamped message", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    sync.filter([msg("a", 1000)]);
    sync.filter([msg("a", 1)]);
    expect(stamps(sync.filter([msg("b", 1)]))).toEqual([`a@${S}`, `b@${S}`]);
  });

  it("releases a set completed in a batch even if a later message of it would evict it", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    sync.filter([msg("a", 1)]);
    // b completes 1, then a@12 would push a@1 out of the window
    expect(stamps(sync.filter([msg("b", 1), msg("a", 12)]))).toEqual([`a@${S}`, `b@${S}`]);
  });

  it("releases the newest set completed in a batch whatever the arrival order", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    sync.filter([msg("a", 1), msg("a", 2)]);
    expect(stamps(sync.filter([msg("b", 2), msg("b", 1)]))).toEqual([`a@${2n * S}`, `b@${2n * S}`]);
  });

  it("counts a replaced stamp's bytes once", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    const half = SYNC_BYTES_PER_TOPIC / 2;
    sync.filter([msg("a", 1, 100, half)]);
    for (let i = 0; i < 5; i++) {
      sync.filter([msg("a", 2, 100, half)]);
    }
    expect(stamps(sync.filter([msg("b", 1)]))).toEqual([`a@${S}`, `b@${S}`]);
  });

  it("resets buffers when the topics change or on clear", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    sync.filter([msg("a", 1)]);
    sync.setTopics(new Set(["a", "b"])); // same topics: buffers kept
    expect(sync.filter([msg("b", 1)])).toHaveLength(2);

    sync.filter([msg("a", 2)]);
    sync.clear();
    expect(sync.isWaiting()).toBe(true);
    expect(sync.filter([msg("b", 2)])).toEqual([]);

    sync.filter([msg("a", 3)]);
    sync.setTopics(new Set(["a", "c"]));
    expect(sync.filter([msg("c", 3)])).toEqual([]);
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { MessageEvent } from "@lichtblick/suite";

import {
  MAX_SYNC_STAMPS_PER_TOPIC,
  syncTimestamp,
  TimestampSynchronizer,
} from "./TimestampSynchronizer";

function msg(topic: string, sec: number, receiveSec = 100): MessageEvent {
  return {
    topic,
    schemaName: "test",
    receiveTime: { sec: receiveSec, nsec: 0 },
    sizeInBytes: 0,
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

  it("keeps at most MAX_SYNC_STAMPS_PER_TOPIC stamps per topic, evicting the oldest", () => {
    const sync = new TimestampSynchronizer();
    sync.setTopics(new Set(["a", "b"]));
    for (let sec = 0; sec <= MAX_SYNC_STAMPS_PER_TOPIC; sec++) {
      sync.filter([msg("a", sec)]);
    }
    expect(sync.filter([msg("b", 0)])).toEqual([]);
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

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";

import { normalizeLogEvent } from "./conversion";
import { LogLevel } from "./types";

function event(schemaName: string, message: unknown): MessageEvent {
  return {
    topic: "/log",
    schemaName,
    receiveTime: { sec: 100, nsec: 1 },
    sizeInBytes: 0,
    message,
  };
}

describe("normalizeLogEvent", () => {
  it.each([
    ["rosgraph_msgs/Log", { header: { stamp: { sec: 1, nsec: 2 } }, level: 8, msg: "m" }],
    ["ros.rosgraph_msgs.Log", { header: { stamp: { sec: 1, nsec: 2 } }, level: 8, msg: "m" }],
    ["rcl_interfaces/msg/Log", { stamp: { sec: 1, nsec: 2 }, level: 40, msg: "m" }],
    ["ros.rcl_interfaces.Log", { stamp: { sec: 1, nsec: 2 }, level: 40, msg: "m" }],
    ["foxglove.Log", { timestamp: { sec: 1, nsec: 2 }, level: 4, message: "m" }],
    ["foxglove.Log", { timestamp: 1_000_000_002n, level: 4, message: "m" }],
    ["foxglove_msgs/msg/Log", { timestamp: { seconds: 1, nanos: 2 }, level: 4, message: "m" }],
  ])("normalizes %s", (schemaName, message) => {
    expect(normalizeLogEvent(event(schemaName, message))).toEqual(
      expect.objectContaining({
        topic: "/log",
        receiveTime: { sec: 100, nsec: 1 },
        stamp: { sec: 1, nsec: 2 },
        level: LogLevel.ERROR,
        message: "m",
      }),
    );
  });

  it("caches the result per event", () => {
    const e = event("rosgraph_msgs/Log", { level: 2, msg: "a" });
    expect(normalizeLogEvent(e)).toBe(normalizeLogEvent(e));
  });

  it("falls back to zero stamp and unknown level", () => {
    expect(normalizeLogEvent(event("unknown", { msg: "a" }))).toEqual(
      expect.objectContaining({
        stamp: { sec: 0, nsec: 0 },
        level: LogLevel.UNKNOWN,
      }),
    );
  });
});

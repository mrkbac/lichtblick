// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { parseMessagePath } from "@lichtblick/message-path";
import { MessageEvent } from "@lichtblick/suite";

import { getSeriesTimestamp, timeFromFieldValue } from "./seriesTimestamp";

const event: MessageEvent = {
  topic: "/odom",
  schemaName: "Odom",
  receiveTime: { sec: 100, nsec: 0 },
  sizeInBytes: 0,
  message: {
    header: { stamp: { sec: 90, nsec: 5 } },
    sensor_time: { sec: 80, nsec: 0 },
    t_ns: 70_000_000_001n,
    t_sec: 60.5,
  },
};

describe("timeFromFieldValue", () => {
  it("reads times, integer nanoseconds and float seconds", () => {
    expect(timeFromFieldValue({ sec: 1, nsec: 2 })).toEqual({ sec: 1, nsec: 2 });
    expect(timeFromFieldValue(1_500_000_000n)).toEqual({ sec: 1, nsec: 500_000_000 });
    expect(timeFromFieldValue(2.25)).toEqual({ sec: 2, nsec: 250_000_000 });
  });

  it("ignores values that are not times", () => {
    expect(timeFromFieldValue("12")).toBeUndefined();
    expect(timeFromFieldValue(Number.NaN)).toBeUndefined();
    expect(timeFromFieldValue(undefined)).toBeUndefined();
  });
});

describe("getSeriesTimestamp", () => {
  it("uses the receive time or the header stamp", () => {
    expect(getSeriesTimestamp(event, "receiveTime", undefined)).toEqual({ sec: 100, nsec: 0 });
    expect(getSeriesTimestamp(event, "headerStamp", undefined)).toEqual({ sec: 90, nsec: 5 });
  });

  it("reads a custom field", () => {
    const path = (field: string) => parseMessagePath(`/odom.${field}`)!;
    expect(getSeriesTimestamp(event, "customField", path("sensor_time"))).toEqual({
      sec: 80,
      nsec: 0,
    });
    expect(getSeriesTimestamp(event, "customField", path("t_ns"))).toEqual({ sec: 70, nsec: 1 });
    expect(getSeriesTimestamp(event, "customField", path("t_sec"))).toEqual({
      sec: 60,
      nsec: 500_000_000,
    });
  });

  it("has no time for a custom field without a path", () => {
    expect(getSeriesTimestamp(event, "customField", undefined)).toBeUndefined();
  });
});

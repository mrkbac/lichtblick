// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2018-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import type { Mock } from "vitest";

import * as time from "./time";

describe("time.formatTimeRaw", () => {
  it("formats whole values correction", () => {
    expect(time.formatTimeRaw({ sec: 1, nsec: 0 })).toEqual("1.000000000");
  });

  it("formats partial nanos", () => {
    expect(time.formatTimeRaw({ sec: 102, nsec: 304 })).toEqual("102.000000304");
    expect(time.formatTimeRaw({ sec: 102, nsec: 99900000 })).toEqual("102.099900000");
  });

  it("formats max nanos", () => {
    expect(time.formatTimeRaw({ sec: 102, nsec: 999000000 })).toEqual("102.999000000");
  });

  it("does not format negative times", () => {
    expect(time.formatTimeRaw({ sec: -1, nsec: 0 })).toEqual("(invalid negative time)");
    expect(console.error).toHaveBeenCalled();
    (console.error as Mock).mockClear();
  });
});

describe("time.getTimestampForMessage", () => {
  it("returns undefined for a null message", () => {
    expect(time.getTimestampForMessage(null)).toBeUndefined();
  });

  it("reads ROS 2 header stamps", () => {
    expect(time.getTimestampForMessage({ header: { stamp: { sec: 3, nanosec: 7 } } })).toEqual({
      sec: 3,
      nsec: 7,
    });
    expect(
      time.getTimestampForMessage({ markers: [{ header: { stamp: { sec: 4, nanosec: 8 } } }] }),
    ).toEqual({ sec: 4, nsec: 8 });
  });
});

describe("time.stampToTime", () => {
  it("reads ROS 1 / Foxglove and ROS 2 stamps", () => {
    const stamp = { sec: 1, nsec: 2 };
    expect(time.stampToTime(stamp)).toBe(stamp);
    expect(time.stampToTime({ sec: 1, nanosec: 2 })).toEqual({ sec: 1, nsec: 2 });
  });

  it("returns undefined for values that are not stamps", () => {
    expect(time.stampToTime(undefined)).toBeUndefined();
    expect(time.stampToTime(5)).toBeUndefined();
    expect(time.stampToTime({ sec: 1 })).toBeUndefined();
    expect(time.stampToTime({ sec: "1", nsec: 2 })).toBeUndefined();
  });
});

describe("time.parseTimeUrlString", () => {
  it("returns undefined for undefined input", () => {
    const result = time.parseTimeUrlString(undefined);
    expect(result).toBeUndefined();
  });

  it("parses RFC3339 strings", () => {
    const timeString = "2023-06-01T12:34:56Z";
    const result = time.parseTimeUrlString(timeString);
    expect(result).toEqual({ sec: 1685622896, nsec: 0 });
  });

  it("parses raw sec.nsec format", () => {
    const timeString = "12.345678901";
    const result = time.parseTimeUrlString(timeString);
    expect(result).toEqual({ sec: 12, nsec: 345678901 });
  });

  it("returns undefined for invalid strings", () => {
    const timeString = "invalid";
    const result = time.parseTimeUrlString(timeString);
    expect(result).toBeUndefined();
  });
});

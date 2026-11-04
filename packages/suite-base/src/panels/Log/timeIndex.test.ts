// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { findLevel, lastIndexAtOrBefore, searchByTime } from "./timeIndex";
import { LogLevel, NormalizedLogMessage } from "./types";

const at = (sec: number, level = LogLevel.INFO): NormalizedLogMessage => ({
  topic: "/log",
  receiveTime: { sec, nsec: 0 },
  stamp: { sec, nsec: 0 },
  level,
  message: String(sec),
});

// times:         1  2  2  3              4  5
const items = [at(1), at(2), at(2, LogLevel.WARN), at(3), at(4, LogLevel.ERROR), at(5)];

describe("timeIndex", () => {
  it("binary searches by receive time", () => {
    expect(searchByTime(items, { sec: 2, nsec: 0 })).toBe(3);
    expect(searchByTime(items, { sec: 2, nsec: 0 }, { inclusive: true })).toBe(1);
    expect(searchByTime([], { sec: 2, nsec: 0 })).toBe(0);
  });

  it("finds the last item at or before a time", () => {
    expect(lastIndexAtOrBefore(items, { sec: 0, nsec: 0 })).toBe(-1);
    expect(lastIndexAtOrBefore(items, { sec: 2, nsec: 5 })).toBe(2);
    expect(lastIndexAtOrBefore(items, { sec: 9, nsec: 0 })).toBe(5);
  });

  it("finds the next and previous problem strictly after/before a time", () => {
    expect(findLevel(items, { sec: 0, nsec: 0 }, 1)).toBe(2);
    expect(findLevel(items, { sec: 2, nsec: 0 }, 1)).toBe(4);
    expect(findLevel(items, { sec: 4, nsec: 0 }, 1)).toBe(-1);
    expect(findLevel(items, { sec: 4, nsec: 0 }, -1)).toBe(2);
    expect(findLevel(items, { sec: 2, nsec: 0 }, -1)).toBe(-1);
    expect(findLevel(items, { sec: 9, nsec: 0 }, -1, LogLevel.ERROR)).toBe(4);
  });

  it("starts at the ends without an anchor time", () => {
    expect(findLevel(items, undefined, 1)).toBe(2);
    expect(findLevel(items, undefined, -1)).toBe(4);
  });
});

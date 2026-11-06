// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { binLevels, roundUpDuration } from "./SeverityTimeline";
import { LogLevel, NormalizedLogMessage } from "./types";

const at = (sec: number, level: LogLevel): NormalizedLogMessage => ({
  topic: "/log",
  receiveTime: { sec, nsec: 0 },
  stamp: { sec, nsec: 0 },
  level,
  message: "",
});

describe("binLevels", () => {
  it("keeps the highest level per column, offset by one", () => {
    const bins = binLevels(
      [
        at(10, LogLevel.INFO),
        at(10, LogLevel.ERROR),
        at(15, LogLevel.UNKNOWN),
        at(19, LogLevel.WARN),
        at(30, LogLevel.FATAL),
      ],
      { sec: 10, nsec: 0 },
      10,
      2,
    );
    expect([...bins]).toEqual([LogLevel.ERROR + 1, LogLevel.WARN + 1]);
  });

  it("puts a message at the end time into the last column", () => {
    const bins = binLevels([at(20, LogLevel.WARN)], { sec: 10, nsec: 0 }, 10, 4);
    expect([...bins]).toEqual([0, 0, 0, LogLevel.WARN + 1]);
  });

  it("handles empty ranges", () => {
    expect(binLevels([at(1, LogLevel.INFO)], { sec: 0, nsec: 0 }, 0, 10)).toHaveLength(10);
    expect(binLevels([], { sec: 0, nsec: 0 }, 10, 0)).toHaveLength(0);
  });
});

describe("roundUpDuration", () => {
  it("rounds up by less than 1/1024 and stays put for small changes", () => {
    for (const duration of [0.5, 10, 60, 600.25, 3600]) {
      const rounded = roundUpDuration(duration);
      expect(rounded).toBeGreaterThanOrEqual(duration);
      expect(rounded - duration).toBeLessThan(duration / 1024);
    }
    expect(roundUpDuration(600.01)).toBe(roundUpDuration(600.2));
    expect(roundUpDuration(0)).toBe(0);
  });
});

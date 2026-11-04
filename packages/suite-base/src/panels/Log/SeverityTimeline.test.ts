// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { binLevels } from "./SeverityTimeline";
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

  it("handles empty ranges", () => {
    expect(binLevels([at(1, LogLevel.INFO)], { sec: 0, nsec: 0 }, 0, 10)).toHaveLength(10);
    expect(binLevels([], { sec: 0, nsec: 0 }, 10, 0)).toHaveLength(0);
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LEVELS } from "@lichtblick/suite-base/panels/DiagnosticSummary/constants";

import {
  appendBounded,
  changesFor,
  CheckHistory,
  formatElapsed,
  levelAt,
  toTimelineRuns,
} from "./history";

const { OK, WARN, ERROR, STALE } = LEVELS;

describe("changesFor", () => {
  it("starts a history with the first level", () => {
    expect(changesFor(undefined, WARN, 5, 3)).toEqual([{ t: 5, level: WARN }]);
  });

  it("records only level changes", () => {
    const prev: CheckHistory = { changes: [{ t: 0, level: OK }], lastSeen: 1 };
    expect(changesFor(prev, OK, 2, 3)).toEqual([]);
    expect(changesFor(prev, ERROR, 2, 3)).toEqual([{ t: 2, level: ERROR }]);
  });

  it("inserts STALE for gaps longer than the stale timeout", () => {
    const prev: CheckHistory = { changes: [{ t: 0, level: OK }], lastSeen: 1 };
    expect(changesFor(prev, OK, 10, 3)).toEqual([
      { t: 4, level: STALE },
      { t: 10, level: OK },
    ]);
    expect(changesFor(prev, OK, 10, 0)).toEqual([]);
  });
});

describe("levelAt", () => {
  const history: CheckHistory = {
    changes: [
      { t: 0, level: OK },
      { t: 10, level: ERROR },
    ],
    lastSeen: 20,
  };

  it("finds the level in effect and since when", () => {
    expect(levelAt(history, -1, 5)).toBeUndefined();
    expect(levelAt(history, 5, 5)).toEqual({ t: 0, level: OK });
    expect(levelAt(history, 10, 5)).toEqual({ t: 10, level: ERROR });
    expect(levelAt(history, 24, 5)).toEqual({ t: 10, level: ERROR });
  });

  it("reports STALE after the last message times out", () => {
    expect(levelAt(history, 30, 5)).toEqual({ t: 25, level: STALE });
    expect(levelAt(history, 30, 0)).toEqual({ t: 10, level: ERROR });
  });
});

describe("toTimelineRuns", () => {
  it("maps levels to merged bucket runs and marks the stale tail", () => {
    const history: CheckHistory = {
      changes: [
        { t: 0, level: OK },
        { t: 5, level: WARN },
      ],
      lastSeen: 6,
    };
    expect(toTimelineRuns(history, 0, 10, 10, 2)).toEqual([
      { x: 0, w: 5, level: OK },
      { x: 5, w: 3, level: WARN },
      { x: 8, w: 2, level: STALE },
    ]);
  });

  it("keeps a short error visible inside one bucket", () => {
    const history: CheckHistory = {
      changes: [
        { t: 0, level: OK },
        { t: 50.1, level: ERROR },
        { t: 50.2, level: OK },
      ],
      lastSeen: 100,
    };
    const runs = toTimelineRuns(history, 0, 100, 10, 0);
    expect(runs).toEqual([
      { x: 0, w: 5, level: OK },
      { x: 5, w: 1, level: ERROR },
      { x: 6, w: 4, level: OK },
    ]);
  });

  it("leaves time before the first message empty", () => {
    const history: CheckHistory = { changes: [{ t: 5, level: OK }], lastSeen: 10 };
    expect(toTimelineRuns(history, 0, 10, 10, 0)).toEqual([{ x: 5, w: 5, level: OK }]);
    expect(toTimelineRuns(history, 10, 10, 10, 0)).toEqual([]);
  });
});

describe("appendBounded", () => {
  it("drops the oldest changes beyond the limit", () => {
    const changes = [
      { t: 1, level: OK },
      { t: 2, level: WARN },
    ];
    expect(appendBounded(changes, [{ t: 3, level: ERROR }], 2)).toEqual([
      { t: 2, level: WARN },
      { t: 3, level: ERROR },
    ]);
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "0s"],
    [59.9, "59s"],
    [61, "1m 01s"],
    [3725, "1h 02m"],
  ])("formats %p as %p", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });
});

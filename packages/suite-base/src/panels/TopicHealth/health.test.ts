// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TopicStats } from "@lichtblick/suite-base/players/types";

import {
  HISTORY_LENGTH,
  RateSample,
  recordingAge,
  recordingRate,
  sampleLiveRates,
  staleAfterSec,
  topicStatus,
} from "./health";

const stats = (numMessages: number) => new Map<string, TopicStats>([["/a", { numMessages }]]);

describe("sampleLiveRates", () => {
  it("smooths rates, decays while silent, and learns a peak only after enough messages", () => {
    let samples: Map<string, RateSample> = sampleLiveRates(new Map(), stats(0), 0);
    expect(samples.get("/a")).toMatchObject({
      count: 0,
      lastMessageMs: undefined,
    });

    samples = sampleLiveRates(samples, stats(5), 1000);
    expect(samples.get("/a")).toMatchObject({
      hz: 5,
      peakHz: undefined,
      lastMessageMs: 1000,
    });

    samples = sampleLiveRates(samples, stats(15), 2000);
    expect(samples.get("/a")!.hz).toBeCloseTo(5 + 0.3 * (10 - 5));
    expect(samples.get("/a")!.peakHz).toBeCloseTo(6.5);

    samples = sampleLiveRates(samples, stats(15), 3000);
    expect(samples.get("/a")!.hz).toBeCloseTo(6.5 * 0.7);
    expect(samples.get("/a")!.peakHz).toBeCloseTo(6.5);
    expect(samples.get("/a")!.lastMessageMs).toBe(2000);
    expect(samples.get("/a")!.history).toEqual([5, 10, 0]);
  });

  it("bounds history and treats a counter reset as silence instead of a negative rate", () => {
    let samples = sampleLiveRates(new Map(), stats(100), 0);
    for (let i = 1; i <= HISTORY_LENGTH + 5; i++) {
      samples = sampleLiveRates(samples, stats(100 + i), i * 1000);
    }
    expect(samples.get("/a")!.history).toHaveLength(HISTORY_LENGTH);
    samples = sampleLiveRates(samples, stats(0), (HISTORY_LENGTH + 6) * 1000);
    expect(samples.get("/a")!.history.at(-1)).toBe(0);
    expect(samples.get("/a")!.count).toBe(0);
  });
});

describe("recording helpers", () => {
  const stat: TopicStats = {
    numMessages: 11,
    firstMessageTime: { sec: 10, nsec: 0 },
    lastMessageTime: { sec: 20, nsec: 0 },
  };
  it("computes the average rate and the time since the topic ended", () => {
    expect(recordingRate(stat)).toBeCloseTo(1);
    expect(recordingRate({ numMessages: 1 })).toBeUndefined();
    expect(recordingAge(stat, { sec: 15, nsec: 0 })).toBe(0);
    expect(recordingAge(stat, { sec: 23, nsec: 0 })).toBe(3);
    expect(recordingAge(stat, undefined)).toBeUndefined();
  });
});

describe("topicStatus", () => {
  const base = { tolerancePercent: 20 };
  it("derives the stale timeout from the expected rate unless overridden", () => {
    expect(staleAfterSec(undefined, 10)).toBe(1);
    expect(staleAfterSec(undefined, 0.5)).toBe(10);
    expect(staleAfterSec({ staleAfterSec: 3 }, 10)).toBe(3);
    expect(staleAfterSec(undefined, undefined)).toBeUndefined();
  });

  it("classifies ok, slow, stale and unmeasured topics", () => {
    expect(
      topicStatus({
        ...base,
        rateHz: 9,
        expectedHz: 10,
        ageSec: 0.1,
        staleAfterSec: 1,
      }),
    ).toBe("ok");
    expect(
      topicStatus({
        ...base,
        rateHz: 7.9,
        expectedHz: 10,
        ageSec: 0.1,
        staleAfterSec: 1,
      }),
    ).toBe("slow");
    expect(
      topicStatus({
        ...base,
        rateHz: 10,
        expectedHz: 10,
        ageSec: 2,
        staleAfterSec: 1,
      }),
    ).toBe("stale");
    expect(topicStatus({ ...base })).toBe("unmeasured");
    // A latched topic with no learned rate is never stale or slow.
    expect(topicStatus({ ...base, ageSec: 600 })).toBe("ok");
    // Zero disables monitoring.
    expect(
      topicStatus({
        ...base,
        rateHz: 0,
        expectedHz: 0,
        ageSec: 600,
        staleAfterSec: 1,
      }),
    ).toBe("ok");
  });
});

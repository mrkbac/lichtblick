// SPDX-License-Identifier: MPL-2.0

// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { TopicStats } from "@lichtblick/suite-base/players/types";
import { LiveTopicRates } from "@lichtblick/suite-base/util/LiveTopicRates";

import {
  HISTORY_LENGTH,
  averageRate,
  RateSample,
  recordingAge,
  recordingRate,
  sampleLiveRates,
  staleAfterSec,
  topicStatus,
} from "./health";

const stats = (numMessages: number) => new Map<string, TopicStats>([["/a", { numMessages }]]);

describe("sampleLiveRates", () => {
  // The rates Data Source Info shows, sampled the same way the panel does
  const sampler = () => {
    const tracker = new LiveTopicRates();
    let samples = new Map<string, RateSample>();
    return (count: number, nowMs: number) => {
      samples = sampleLiveRates(samples, stats(count), nowMs, tracker.update(nowMs, stats(count)));
      return samples.get("/a")!;
    };
  };

  it("uses the shared live rate, drops to 0 when stale, and learns only after enough messages", () => {
    const sample = sampler();
    expect(sample(0, 0)).toMatchObject({ count: 0, lastMessageMs: undefined });
    expect(sample(5, 1000)).toMatchObject({ lastMessageMs: 1000, peakHz: undefined });
    expect(sample(15, 2000)).toMatchObject({ hz: 7.5, lastMessageMs: 2000 });
    expect(sample(25, 3000).hz).toBe(10);
    // Not learned from fewer samples than the median window
    expect(sample(35, 4000).peakHz).toBeUndefined();
    expect(sample(45, 5000).peakHz).toBe(10);

    // Silent past the stale window: 0 Hz, and the last message time stays
    sample(45, 6000);
    const stale = sample(45, 8000);
    expect(stale.hz).toBe(0);
    expect(stale.lastMessageMs).toBe(5000);
    expect(stale.history.slice(-3)).toEqual([10, 10, 0]);
  });

  it("learns a steady topic's rate despite ticks that catch one message more", () => {
    // A 1 Hz topic sampled by a drifting 1 s timer: now and then a tick holds two messages
    const sample = sampler();
    let count = 0;
    let last = sample(count, 0);
    for (let i = 1; i <= 120; i++) {
      count += i % 7 === 0 ? 2 : i % 7 === 1 ? 0 : 1;
      last = sample(count, i * 1000);
    }
    expect(last.peakHz).toBeCloseTo(1, 0);
    expect(topicStatus({ rateHz: last.hz, expectedHz: last.peakHz, tolerancePercent: 20 })).toBe(
      "ok",
    );
  });

  it("bounds history and treats a counter reset as a fresh start", () => {
    const sample = sampler();
    sample(100, 0);
    for (let i = 1; i <= HISTORY_LENGTH + 5; i++) {
      sample(100 + i, i * 1000);
    }
    expect(sample(100 + HISTORY_LENGTH + 6, (HISTORY_LENGTH + 6) * 1000).history).toHaveLength(
      HISTORY_LENGTH,
    );
    const reset = sample(0, (HISTORY_LENGTH + 7) * 1000);
    expect(reset.history.at(-1)).toBe(0);
    expect(reset.count).toBe(0);
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
    expect(averageRate({ numMessages: 40 }, { sec: 0, nsec: 0 }, { sec: 20, nsec: 0 })).toBe(2);
    expect(
      averageRate({ numMessages: 0 }, { sec: 0, nsec: 0 }, { sec: 20, nsec: 0 }),
    ).toBeUndefined();
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

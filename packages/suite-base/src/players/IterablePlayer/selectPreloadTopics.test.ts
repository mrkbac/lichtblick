// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { selectPreloadTopics } from "./selectPreloadTopics";

describe("selectPreloadTopics", () => {
  it("matches a brute-force optimum even when admitting topics changes the eviction room", () => {
    let seed = 42;
    const next = (modulus: number) => (seed = (seed * 16807) % 2147483647) % modulus;
    for (let round = 0; round < 100; round++) {
      const topics = Array.from({ length: 1 + next(7) }, (_, index) => ({
        topic: String(index),
        cost: next(15) - 6,
        projectedBytes: 1 + next(15),
      }));
      const available = next(20) - 5;
      const score = (selected: typeof topics) => ({
        count: selected.length,
        footprint: Math.max(0, ...selected.map((topic) => topic.projectedBytes)),
      });
      const feasible = Array.from({ length: 2 ** topics.length }, (_, mask) =>
        topics.filter((_topic, index) => (mask & (1 << index)) !== 0),
      ).filter((subset) => subset.reduce((sum, topic) => sum + topic.cost, 0) <= available);
      const best = feasible
        .map(score)
        .sort((a, b) => (a.count === b.count ? a.footprint - b.footprint : b.count - a.count))[0];
      const selected = selectPreloadTopics(topics, available);
      expect(score(topics.filter((topic) => selected.has(topic.topic)))).toEqual(
        best ?? { count: 0, footprint: 0 },
      );
    }
  });
});

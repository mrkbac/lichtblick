// SPDX-License-Identifier: MPL-2.0

type TopicCost = {
  topic: string;
  /** Added bytes plus eviction room lost by admitting this topic. May be negative. */
  cost: number;
  /** Bytes the topic would hold before eviction. */
  projectedBytes: number;
};

/**
 * At an overloaded block, admit as many topic slices as possible within the available bytes.
 * Among equally large selections, minimize the largest admitted topic's projected footprint.
 */
export function selectPreloadTopics(topics: readonly TopicCost[], available: number): Set<string> {
  const byCost = [...topics].sort((a, b) =>
    a.cost === b.cost ? a.projectedBytes - b.projectedBytes : a.cost - b.cost,
  );
  let total = 0;
  let count = 0;
  for (const [index, topic] of byCost.entries()) {
    total += topic.cost;
    if (total <= available) {
      count = index + 1;
    }
  }
  if (count === 0) {
    return new Set();
  }

  const footprints = byCost.map((topic) => topic.projectedBytes).sort((a, b) => a - b);
  const cheapest = (max: number) =>
    byCost.filter((topic) => topic.projectedBytes <= max).slice(0, count);
  let lo = 0;
  let hi = footprints.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidates = cheapest(footprints[mid]!);
    if (
      candidates.length === count &&
      candidates.reduce((sum, topic) => sum + topic.cost, 0) <= available
    ) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return new Set(cheapest(footprints[lo]!).map((topic) => topic.topic));
}

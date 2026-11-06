// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Live rates are measured over about this many milliseconds of recent messages. */
export const LIVE_RATE_WINDOW_MS = 2000;

export type LiveRate = {
  /** Messages per second; 0 once the topic is stale, undefined until there is enough data. */
  hz: number | undefined;
  /** Nothing arrived for longer than the window and twice the usual interval. */
  stale: boolean;
};

type Sample = { timeMs: number; count: number };

/**
 * Sliding-window publish rates from cumulative per-topic message counts, sampled over time.
 * A topic whose publisher stops drops to 0 Hz and is marked stale instead of keeping its last rate.
 */
export class LiveTopicRates {
  /** Per topic, the samples at which the count grew, oldest first. The first is the window baseline. */
  #samples = new Map<string, Sample[]>();
  /** Per topic, the usual time between messages as of the last arrival. */
  #intervalMs = new Map<string, number>();

  public update(
    nowMs: number,
    stats: ReadonlyMap<string, { numMessages: number }>,
  ): Map<string, LiveRate> {
    const result = new Map<string, LiveRate>();
    for (const [topic, { numMessages }] of stats) {
      let samples = this.#samples.get(topic);
      if (!samples) {
        // We only know the count from now on, not when those messages arrived
        samples = [{ timeMs: nowMs, count: numMessages }];
        this.#samples.set(topic, samples);
      }
      let last = samples[samples.length - 1]!;
      const recovering =
        this.#intervalMs.has(topic) && nowMs - last.timeMs > this.#staleAfterMs(topic);
      if (numMessages > last.count && recovering) {
        // First message after a stale gap: the gap is not the usual interval, so keep the known
        // estimate and measure the rate from here on
        last = { timeMs: nowMs, count: numMessages };
        samples = [last];
        this.#samples.set(topic, samples);
      } else if (numMessages > last.count) {
        last = { timeMs: nowMs, count: numMessages };
        samples.push(last);
        // Keep the newest sample at or before the window start as baseline, and at least two samples
        while (samples.length > 2 && samples[1]!.timeMs <= nowMs - LIVE_RATE_WINDOW_MS) {
          samples.shift();
        }
        const first = samples[0]!;
        this.#intervalMs.set(topic, (last.timeMs - first.timeMs) / (last.count - first.count));
      } else if (numMessages < last.count) {
        // Counts restarted (e.g. reconnect): start over
        this.#samples.set(topic, [{ timeMs: nowMs, count: numMessages }]);
        this.#intervalMs.delete(topic);
        result.set(topic, { hz: undefined, stale: false });
        continue;
      }

      const silentMs = nowMs - last.timeMs;
      if (silentMs > this.#staleAfterMs(topic)) {
        result.set(topic, { hz: 0, stale: true });
        continue;
      }
      const first = samples[0]!;
      const spanMs = last.timeMs - first.timeMs;
      result.set(topic, {
        hz: spanMs > 0 ? ((last.count - first.count) * 1000) / spanMs : undefined,
        stale: false,
      });
    }
    // Forget topics that went away, so a returning topic starts fresh
    for (const topic of this.#samples.keys()) {
      if (!stats.has(topic)) {
        this.#samples.delete(topic);
        this.#intervalMs.delete(topic);
      }
    }
    return result;
  }

  #staleAfterMs(topic: string): number {
    return Math.max(LIVE_RATE_WINDOW_MS, 2 * (this.#intervalMs.get(topic) ?? 0));
  }
}

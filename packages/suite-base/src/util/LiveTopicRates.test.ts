// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { LiveTopicRates } from "./LiveTopicRates";

const stats = (numMessages: number) => new Map([["/topic", { numMessages }]]);

/** Feeds `hz` messages per second until `untilMs`, one sample per message. */
function publish(rates: LiveTopicRates, hz: number, fromMs: number, untilMs: number, count = 0) {
  let n = count;
  for (let t = fromMs; t <= untilMs; t += 1000 / hz) {
    rates.update(t, stats(++n));
  }
  return n;
}

describe("LiveTopicRates", () => {
  it("has no rate from a single sample", () => {
    const rates = new LiveTopicRates();
    expect(rates.update(0, stats(5)).get("/topic")).toEqual({ hz: undefined, stale: false });
  });

  it("measures the rate over the recent window", () => {
    const rates = new LiveTopicRates();
    const n = publish(rates, 10, 0, 5000);
    expect(rates.update(5050, stats(n)).get("/topic")!.hz).toBeCloseTo(10);
  });

  it("follows a rate change within the window", () => {
    const rates = new LiveTopicRates();
    let n = publish(rates, 50, 0, 5000);
    n = publish(rates, 5, 5200, 9000, n);
    expect(rates.update(9000, stats(n)).get("/topic")!.hz).toBeCloseTo(5);
  });

  it("reports 0 Hz and stale once the publisher stops", () => {
    const rates = new LiveTopicRates();
    const n = publish(rates, 10, 0, 3000);
    expect(rates.update(4900, stats(n)).get("/topic")).toEqual({ hz: 10, stale: false });
    expect(rates.update(5100, stats(n)).get("/topic")).toEqual({ hz: 0, stale: true });
    // and recovers when messages arrive again
    rates.update(6000, stats(n + 1));
    expect(rates.update(6100, stats(n + 2)).get("/topic")!.stale).toBe(false);
  });

  it("waits twice the usual interval for slow topics", () => {
    const rates = new LiveTopicRates();
    // every 3 s: the window alone would call it stale between messages
    const n = publish(rates, 1 / 3, 0, 9000);
    expect(rates.update(14_000, stats(n)).get("/topic")).toEqual({ hz: 1 / 3, stale: false });
    expect(rates.update(15_100, stats(n)).get("/topic")).toEqual({ hz: 0, stale: true });
  });

  it("starts over when the count restarts", () => {
    const rates = new LiveTopicRates();
    publish(rates, 10, 0, 1000);
    expect(rates.update(1100, stats(1)).get("/topic")).toEqual({ hz: undefined, stale: false });
  });
});

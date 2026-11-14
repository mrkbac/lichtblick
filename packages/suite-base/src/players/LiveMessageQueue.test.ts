// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import {
  LIVE_QUEUE_FULL_ALERT_ID,
  LiveMessageQueue,
} from "@lichtblick/suite-base/players/LiveMessageQueue";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

function msg(i: number, sizeInBytes: number): MessageEvent {
  return {
    topic: "/a",
    receiveTime: { sec: i, nsec: 0 },
    message: i,
    sizeInBytes,
    schemaName: "x",
  };
}

describe("LiveMessageQueue", () => {
  it("rejects a missing or infinite cap", () => {
    const alerts = new PlayerAlertManager();
    expect(() => new LiveMessageQueue(Infinity, alerts)).toThrow();
    expect(() => new LiveMessageQueue(0, alerts)).toThrow();
    expect(() => new LiveMessageQueue(NaN, alerts)).toThrow();
  });

  it("drains in order and resets the byte count", () => {
    const queue = new LiveMessageQueue(100, new PlayerAlertManager());
    queue.push(msg(1, 10));
    queue.push(msg(2, 10));
    expect(queue.sizeInBytes()).toBe(20);
    expect(queue.drain().map((m) => m.message)).toEqual([1, 2]);
    expect(queue.sizeInBytes()).toBe(0);
    expect(queue.length()).toBe(0);
  });

  it("drops the oldest messages past the cap and raises one alert", () => {
    const alerts = new PlayerAlertManager();
    const queue = new LiveMessageQueue(100, alerts);
    for (let i = 0; i < 1000; i++) {
      queue.push(msg(i, 10));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(100);
    }
    const kept = queue.drain().map((m) => m.message as number);
    expect(kept.at(-1)).toBe(999);
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
    expect(alerts.alerts()).toHaveLength(1);
    expect(alerts.hasAlert(LIVE_QUEUE_FULL_ALERT_ID)).toBe(true);
    // The alert is logged once, not once per drop.
    expect(console.warn).toHaveBeenCalledTimes(1);
    (console.warn as Mock).mockClear();
  });
});

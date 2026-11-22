// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import type { Mock } from "vitest";

import {
  LIVE_QUEUE_FULL_ALERT_ID,
  LiveMessageQueue,
} from "@lichtblick/suite-base/players/LiveMessageQueue";
import PlayerAlertManager from "@lichtblick/suite-base/players/PlayerAlertManager";
import { MessageEvent } from "@lichtblick/suite-base/players/types";

function msg(i: number, sizeInBytes: number, topic = "/a", message: unknown = i): MessageEvent {
  return {
    topic,
    receiveTime: { sec: i, nsec: 0 },
    message,
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

  it("keeps the newest message per topic and per transform child frame when dropping", () => {
    const queue = new LiveMessageQueue(1000, new PlayerAlertManager());
    const tf = (i: number, ...children: string[]) =>
      msg(i, 10, "/transforms", {
        transforms: children.map((child_frame_id) => ({ child_frame_id })),
      });
    const latched = msg(0, 10, "/latched");
    const staticFrame = tf(1, "static", "moving");
    queue.push(latched);
    queue.push(staticFrame);
    for (let i = 2; i < 5000; i++) {
      queue.push(i % 2 === 0 ? tf(i, "moving") : msg(i, 10));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(1000);
    }
    const kept = queue.drain();
    expect(kept.slice(0, 2)).toEqual([latched, staticFrame]);
    expect(kept.at(-1)!.receiveTime.sec).toBe(4999);
    expect(kept.map((m) => m.receiveTime.sec)).toEqual(
      kept.map((m) => m.receiveTime.sec).sort((a, b) => a - b),
    );
    (console.warn as Mock).mockClear();
  });

  it("drops the oldest regardless once the newest per topic alone exceed the cap", () => {
    const queue = new LiveMessageQueue(100, new PlayerAlertManager());
    for (let i = 0; i < 20; i++) {
      queue.push(msg(i, 10, `/t${i}`));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(100);
    }
    (console.warn as Mock).mockClear();
  });

  it("keeps the static transform first when the newest per topic don't all fit", () => {
    const queue = new LiveMessageQueue(1000, new PlayerAlertManager());
    const staticFrame = msg(0, 10, "/transforms", { transforms: [{ child_frame_id: "static" }] });
    queue.push(staticFrame);
    for (let camera = 1; camera <= 15; camera++) {
      queue.push(msg(camera, 60, `/camera${camera}`)); // 900 bytes of large one-shot messages
    }
    for (let i = 16; i < 300; i++) {
      queue.push(msg(i, 10));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(1000);
    }
    const kept = queue.drain();
    expect(kept[0]).toBe(staticFrame);
    expect(kept.at(-1)!.receiveTime.sec).toBe(299);
    (console.warn as Mock).mockClear();
  });

  it("doesn't keep a dropped message that a still queued one replaces", () => {
    const queue = new LiveMessageQueue(100, new PlayerAlertManager());
    for (let i = 0; i < 50; i++) {
      queue.push(msg(i, 10));
    }
    expect(queue.drain().map((m) => m.receiveTime.sec)).toEqual([42, 43, 44, 45, 46, 47, 48, 49]);
    (console.warn as Mock).mockClear();
  });

  it("drops a kept message once a newer one is queued, to make room for a one-shot map", () => {
    const queue = new LiveMessageQueue(1000, new PlayerAlertManager());
    let t = 0;
    queue.push(msg(t++, 30, "/latched"));
    queue.push(msg(t++, 30, "/camera")); // kept by the first drop, replaced below
    while (t < 100) {
      queue.push(msg(t++, 10));
    }
    const map = msg(t++, 200, "/map"); // one-shot, needs the room the old camera message holds
    queue.push(map);
    for (let i = 0; i < 20; i++) {
      queue.push(msg(t++, 10));
    }
    queue.push(msg(t++, 30, "/camera"));
    while (t < 400) {
      queue.push(msg(t++, 10));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(1000);
    }
    const kept = queue.drain();
    expect(kept).toContain(map);
    expect(kept.map((m) => m.topic)).toContain("/latched");
    expect(queue.sizeInBytes()).toBe(0);
    (console.warn as Mock).mockClear();
  });

  it("ignores malformed transform-like messages", () => {
    const queue = new LiveMessageQueue(100, new PlayerAlertManager());
    for (let i = 0; i < 50; i++) {
      queue.push(msg(i, 10, "/json", { transforms: [null] }));
    }
    expect(queue.drain().at(-1)!.receiveTime.sec).toBe(49);
    (console.warn as Mock).mockClear();
  });

  it("keeps queueing new messages when kept messages are large", () => {
    const queue = new LiveMessageQueue(1000, new PlayerAlertManager());
    let t = 0;
    for (let topic = 0; topic < 23; topic++) {
      queue.push(msg(t++, 45, `/oneShot${topic}`));
    }
    for (let i = 0; i < 300; i++) {
      queue.push(msg(t++, 10));
      expect(queue.sizeInBytes()).toBeLessThanOrEqual(1000);
    }
    const kept = queue.drain();
    expect(kept.filter((m) => m.topic === "/a").length).toBeGreaterThan(40);
    (console.warn as Mock).mockClear();
  });

  it("keeps messages received at the same time in arrival order", () => {
    const queue = new LiveMessageQueue(1000, new PlayerAlertManager());
    const tfs = (...children: string[]) => ({
      transforms: children.map((child_frame_id) => ({ child_frame_id })),
    });
    const older = msg(0, 20, "/transforms", tfs("f", "g"));
    const newer = msg(0, 10, "/transforms", tfs("f")); // same stamp, newer value for f
    queue.push(older);
    queue.push(newer);
    for (let t = 1; t < 300; t++) {
      queue.push(msg(t, 10));
    }
    expect(queue.drain().slice(0, 2)).toEqual([older, newer]);
    (console.warn as Mock).mockClear();
  });
});

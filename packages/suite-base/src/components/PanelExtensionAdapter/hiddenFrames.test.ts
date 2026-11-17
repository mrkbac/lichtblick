// SPDX-License-Identifier: MPL-2.0

import { MessageEvent } from "@lichtblick/suite";
import MessageEventBuilder from "@lichtblick/suite-base/testing/builders/MessageEventBuilder";

import { HIDDEN_RENDER_INTERVAL_MS, HiddenFrames } from "./hiddenFrames";

const frame = (topic: string): MessageEvent[] => [MessageEventBuilder.messageEvent({ topic })];

describe("HiddenFrames", () => {
  it("passes frames straight through while visible", () => {
    const hidden = new HiddenFrames();
    const a = frame("a");
    hidden.add(a, { visible: true });
    expect(hidden.shouldWait({ visible: true, now: 0 })).toBe(false);
    expect(hidden.take(a, 0)).toBe(a);
  });

  it("batches every frame while hidden and hands them out once shown", () => {
    const hidden = new HiddenFrames();
    const [a, b, c] = [frame("a"), frame("b"), frame("c")];
    hidden.add(a, { visible: false });
    expect(hidden.shouldWait({ visible: false, now: 0 })).toBe(false);
    expect(hidden.take(a, 0)).toBe(a);

    hidden.add(b, { visible: false });
    expect(hidden.shouldWait({ visible: false, now: 10 })).toBe(true);
    hidden.add(c, { visible: false });
    // Shown again: render right away with everything that arrived meanwhile.
    expect(hidden.shouldWait({ visible: true, now: 20 })).toBe(false);
    const batch = hidden.take(c, 20);
    expect(batch?.map((m) => m.topic)).toEqual(["b", "c"]);
    // Re-running with the same pipeline frame returns the same array, so nothing is delivered twice.
    expect(hidden.take(c, 30)).toBe(batch);
  });

  it("renders a hidden panel again after the interval", () => {
    const hidden = new HiddenFrames();
    hidden.take(undefined, 0);
    expect(hidden.shouldWait({ visible: false, now: HIDDEN_RENDER_INTERVAL_MS - 1 })).toBe(true);
    expect(hidden.shouldWait({ visible: false, now: HIDDEN_RENDER_INTERVAL_MS })).toBe(false);
  });

  it("drops pending frames on clear", () => {
    const hidden = new HiddenFrames();
    const [a, b] = [frame("a"), frame("b")];
    hidden.add(a, { visible: false });
    hidden.clear();
    hidden.add(b, { visible: true });
    expect(hidden.take(b, 0)).toBe(b);
  });

  it("reports pending frames and how long until they may render", () => {
    const hidden = new HiddenFrames();
    hidden.take(undefined, 0);
    hidden.add(frame("a"), { visible: false });
    expect(hidden.hasPending()).toBe(true);
    expect(hidden.waitMs(400)).toBe(HIDDEN_RENDER_INTERVAL_MS - 400);
    hidden.take(undefined, HIDDEN_RENDER_INTERVAL_MS);
    expect(hidden.hasPending()).toBe(false);
  });

  it("drops the handed-out batch once a newer pipeline frame arrives", () => {
    const hidden = new HiddenFrames();
    const [a, b, c] = [frame("a"), frame("b"), frame("c")];
    hidden.add(a, { visible: false });
    hidden.add(b, { visible: false });
    const batch = hidden.take(b, 0);
    expect(hidden.take(c, 1)).toBe(c);
    // The batch is gone: its pipeline frame no longer maps to it.
    expect(hidden.take(b, 2)).toBe(b);
    expect(batch).not.toBe(b);
  });
});

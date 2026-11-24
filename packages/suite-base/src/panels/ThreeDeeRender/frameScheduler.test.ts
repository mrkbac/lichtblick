// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { FRAME_BUDGET_MS, frameSchedulerFor } from "./frameScheduler";

/** A window whose animation frames run when the test says so, with a controllable clock. */
function fakeWindow() {
  let callbacks: FrameRequestCallback[] = [];
  const ownerWindow = {
    requestAnimationFrame: (callback: FrameRequestCallback) => callbacks.push(callback),
    cancelAnimationFrame: (id: number) => {
      callbacks = callbacks.filter((_, index) => index !== id - 1);
    },
  } as unknown as Window;
  const runFrame = () => {
    const due = callbacks;
    callbacks = [];
    for (const callback of due) {
      callback(performance.now());
    }
  };
  return { ownerWindow, runFrame, pending: () => callbacks.length };
}

describe("frameSchedulerFor", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  it("draws each panel once per frame however often it asks", () => {
    const { ownerWindow, runFrame } = fakeWindow();
    const scheduler = frameSchedulerFor(ownerWindow);
    const draw = vi.fn();
    scheduler.request(draw);
    scheduler.request(draw);
    expect(draw).not.toHaveBeenCalled();
    runFrame();
    expect(draw).toHaveBeenCalledOnce();
  });

  it("moves panels past the frame budget to the next frame, first in line", () => {
    const { ownerWindow, runFrame, pending } = fakeWindow();
    const scheduler = frameSchedulerFor(ownerWindow);
    const order: string[] = [];
    const slow = (name: string) => () => {
      order.push(name);
      now += FRAME_BUDGET_MS + 1;
    };
    const a = slow("a");
    const b = slow("b");
    scheduler.request(a);
    scheduler.request(b);
    runFrame();
    expect(order).toEqual(["a"]);
    // A redraw asked for meanwhile waits behind the panel that was moved
    scheduler.request(a);
    runFrame();
    expect(order).toEqual(["a", "b"]);
    runFrame();
    expect(order).toEqual(["a", "b", "a"]);
    expect(pending()).toBe(0);
  });

  it("drops a cancelled draw", () => {
    const { ownerWindow, runFrame, pending } = fakeWindow();
    const scheduler = frameSchedulerFor(ownerWindow);
    const draw = vi.fn();
    scheduler.request(draw);
    scheduler.cancel(draw);
    expect(pending()).toBe(0);
    runFrame();
    expect(draw).not.toHaveBeenCalled();
  });
});

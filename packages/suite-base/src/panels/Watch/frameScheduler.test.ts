/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { createFrameScheduler } from "./frameScheduler";

describe("createFrameScheduler", () => {
  let frames: FrameRequestCallback[];
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames[id - 1] = () => {};
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs once per frame however often it is requested", () => {
    const callback = vi.fn();
    const scheduler = createFrameScheduler(callback);
    for (let i = 0; i < 1000; i++) {
      scheduler.request();
    }
    expect(frames).toHaveLength(1);
    frames[0]!(0);
    expect(callback).toHaveBeenCalledTimes(1);
    scheduler.request();
    expect(frames).toHaveLength(2);
  });

  it("cancels a pending frame", () => {
    const callback = vi.fn();
    const scheduler = createFrameScheduler(callback);
    scheduler.request();
    scheduler.cancel();
    frames[0]!(0);
    expect(callback).not.toHaveBeenCalled();
  });
});

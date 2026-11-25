// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { isTrackpadScroll, makeTrackpadScrollDetector } from "./camera";

function wheel(
  init: Partial<Parameters<typeof isTrackpadScroll>[0]>,
  wheelDeltaY?: number,
): Parameters<typeof isTrackpadScroll>[0] {
  return {
    ctrlKey: false,
    shiftKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    ...init,
    ...(wheelDeltaY != undefined && { wheelDeltaY }),
  };
}

describe("isTrackpadScroll", () => {
  it("detects two-finger scrolling", () => {
    expect(isTrackpadScroll(wheel({ deltaY: 4 }, -12))).toBe(true);
    expect(isTrackpadScroll(wheel({ deltaX: 3, deltaY: 0 }))).toBe(true);
  });

  it("leaves mouse wheels and pinches to zoom", () => {
    expect(isTrackpadScroll(wheel({ deltaY: 100 }, -120))).toBe(false);
    expect(isTrackpadScroll(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(false);
    expect(isTrackpadScroll(wheel({ deltaY: 4, ctrlKey: true }, -12))).toBe(false);
    expect(isTrackpadScroll(wheel({ deltaX: 100, shiftKey: true }))).toBe(false);
  });
});

describe("makeTrackpadScrollDetector", () => {
  const at = (timeStamp: number, init: Parameters<typeof wheel>[0], wheelDeltaY?: number) =>
    ({ ...wheel(init, wheelDeltaY), timeStamp }) as WheelEvent;

  it("keeps a gesture a pan until its events stop, but never a pinch", () => {
    const isPan = makeTrackpadScrollDetector();
    expect(isPan(at(0, { deltaY: 4 }, -12))).toBe(true);
    // Momentum events may not match the trackpad heuristic on their own
    expect(isPan(at(100, { deltaY: 100 }, -120))).toBe(true);
    expect(isPan(at(150, { deltaY: 4, ctrlKey: true }, -12))).toBe(false);
    // A pause ends the gesture, so the mouse wheel zooms again
    expect(isPan(at(1000, { deltaY: 100 }, -120))).toBe(false);
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { isTrackpadScroll } from "./camera";

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
    expect(isTrackpadScroll(wheel({ deltaY: 3, deltaMode: 1 }))).toBe(
      false,
    );
    expect(isTrackpadScroll(wheel({ deltaY: 4, ctrlKey: true }, -12))).toBe(false);
    expect(isTrackpadScroll(wheel({ deltaX: 100, shiftKey: true }))).toBe(false);
  });
});

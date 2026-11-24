/** @vitest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import usePreventWheelDefault from "./usePreventWheelDefault";

function pinch(element: HTMLElement): WheelEvent {
  const event = new WheelEvent("wheel", { ctrlKey: true, deltaY: -10, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

describe("usePreventWheelDefault", () => {
  it("stops a pinch from zooming the page until unmounted", () => {
    const element = document.createElement("div");
    const { unmount } = renderHook(() => {
      usePreventWheelDefault(element);
    });
    expect(pinch(element).defaultPrevented).toBe(true);

    unmount();
    expect(pinch(element).defaultPrevented).toBe(false);
  });
});

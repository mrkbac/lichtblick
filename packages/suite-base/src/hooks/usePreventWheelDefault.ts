// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect } from "react";

/**
 * Stops the browser's default wheel action on an element that handles wheel itself, so a pinch
 * (reported as ctrl+wheel) doesn't zoom the page and a scroll doesn't scroll it. React's onWheel
 * is passive and can't preventDefault.
 */
export default function usePreventWheelDefault(element: HTMLElement | null | undefined): void {
  useEffect(() => {
    if (!element) {
      return;
    }
    const preventDefault = (event: WheelEvent) => {
      event.preventDefault();
    };
    element.addEventListener("wheel", preventDefault, { passive: false });
    return () => {
      element.removeEventListener("wheel", preventDefault);
    };
  }, [element]);
}

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

type ElementSize<T> = {
  /** Callback ref to attach to the element. */
  ref: (element: T | null) => void;
  element: T | null;
  width?: number;
  height?: number;
};

/**
 * Tracks an element's content-box size with a ResizeObserver. Updates are applied on the next
 * animation frame so layout work done in response can't trigger a "ResizeObserver loop" error.
 */
export function useElementSize<T extends Element>(): ElementSize<T> {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    if (!element) {
      return;
    }
    let frame: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      if (frame != undefined) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame != undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [element]);

  return { ref: setElement, element, ...size };
}

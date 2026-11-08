// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

type ElementSize<T> = {
  /** Callback ref to attach to the element. */
  ref: (element: T | null) => void;
  element: T | null;
  width?: number;
  height?: number;
};

/**
 * Tracks an element's content-box size with a ResizeObserver. The new size is rendered
 * synchronously, before the browser paints, so content follows its container in the same frame
 * (e.g. while dragging a panel split) instead of one frame behind.
 */
export function useElementSize<T extends Element>(): ElementSize<T> {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState<{ width?: number; height?: number }>({});

  useEffect(() => {
    if (!element) {
      return;
    }
    const Observer = element.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver;
    const observer = new Observer(([entry]) => {
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      flushSync(() => {
        setSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        );
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element]);

  return { ref: setElement, element, ...size };
}

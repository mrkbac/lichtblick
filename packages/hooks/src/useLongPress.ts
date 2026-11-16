// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef } from "react";

type PressEvent = React.MouseEvent | React.TouchEvent;

function preventGhostClick(ev: TouchEvent): void {
  if (ev.touches.length < 2) {
    ev.preventDefault();
  }
}

/** Props to spread on an element; calls callback after the pointer is held for `delay` ms. */
export function useLongPress(
  callback: (event: PressEvent) => void,
  delay = 300,
): {
  onMouseDown: (event: React.MouseEvent) => void;
  onTouchStart: (event: React.TouchEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onTouchEnd: () => void;
} {
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const target = useRef<EventTarget>(undefined);

  const start = useCallback(
    (event: PressEvent) => {
      // prevent ghost click on mobile devices
      event.target.addEventListener("touchend", preventGhostClick as EventListener, {
        passive: false,
      });
      target.current = event.target;
      timeout.current = setTimeout(() => {
        callback(event);
      }, delay);
    },
    [callback, delay],
  );

  const clear = useCallback(() => {
    clearTimeout(timeout.current);
    target.current?.removeEventListener("touchend", preventGhostClick as EventListener);
  }, []);

  // Cancel a pending press if the component unmounts mid-press.
  useEffect(() => clear, [clear]);

  return {
    onMouseDown: start,
    onTouchStart: start,
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchEnd: clear,
  };
}

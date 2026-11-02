// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

export type PanEvent = {
  /** Distance from where the pointer went down. */
  deltaX: number;
  deltaY: number;
  /** Current pointer position in client coordinates. */
  center: { x: number; y: number };
};

type PanHandlers = {
  onStart: (event: PanEvent) => void;
  onMove: (event: PanEvent) => void;
  onEnd: (event: PanEvent) => void;
};

/**
 * Calls the handlers for a primary-button or touch drag on `element` once it has moved at least
 * `threshold` pixels. Returns a function that removes the listeners.
 */
export function listenForPan(
  element: HTMLElement,
  threshold: number,
  { onStart, onMove, onEnd }: PanHandlers,
): () => void {
  let start: { x: number; y: number; pointerId: number } | undefined;
  let panning = false;

  const toPanEvent = (event: PointerEvent): PanEvent => ({
    deltaX: event.clientX - start!.x,
    deltaY: event.clientY - start!.y,
    center: { x: event.clientX, y: event.clientY },
  });

  const onPointerDown = (event: PointerEvent) => {
    // Every primary press starts a new gesture, so a press released outside the element can't
    // leave a stale start behind
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    start = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    panning = false;
  };
  const end = (event: PointerEvent) => {
    if (panning) {
      onEnd(toPanEvent(event));
    }
    start = undefined;
    panning = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (start?.pointerId !== event.pointerId) {
      return;
    }
    // The button was released where we didn't see the pointerup (e.g. outside the element)
    if ((event.buttons & 1) === 0) {
      end(event);
      return;
    }
    const pan = toPanEvent(event);
    if (!panning) {
      if (Math.hypot(pan.deltaX, pan.deltaY) < threshold) {
        return;
      }
      panning = true;
      // Keep receiving moves when the pointer leaves the element mid-drag
      if ("setPointerCapture" in element) {
        element.setPointerCapture(event.pointerId);
      }
      onStart(pan);
      return;
    }
    onMove(pan);
  };
  const onPointerUp = (event: PointerEvent) => {
    if (start?.pointerId === event.pointerId) {
      end(event);
    }
  };

  // Touch drags pan the chart instead of scrolling the page
  const previousTouchAction = element.style.touchAction;
  element.style.touchAction = "none";
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", onPointerUp);
  element.addEventListener("pointercancel", onPointerUp);
  return () => {
    element.style.touchAction = previousTouchAction;
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", onPointerUp);
    element.removeEventListener("pointercancel", onPointerUp);
  };
}

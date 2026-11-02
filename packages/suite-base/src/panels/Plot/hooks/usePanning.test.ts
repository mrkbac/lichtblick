/** @jest-environment jsdom */
// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0
import { renderHook } from "@testing-library/react";

import { PlotCoordinator } from "@lichtblick/suite-base/panels/Plot/PlotCoordinator";

import usePanning from "./usePanning";

// jsdom has no PointerEvent; a MouseEvent with a pointer event type reaches the same listeners.
function pointer(target: HTMLElement, type: string, clientX: number, clientY: number): void {
  const event = new MouseEvent(type, { clientX, clientY, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("usePanning", () => {
  const boundingClientRect = { x: 0, y: 0, width: 800, height: 600 };

  function setup({ withCanvas = true, withCoordinator = true } = {}) {
    const canvasDiv = withCanvas ? document.createElement("div") : ReactNull;
    if (canvasDiv) {
      canvasDiv.getBoundingClientRect = () => ({ toJSON: () => boundingClientRect }) as DOMRect;
    }
    const addInteractionEvent = vi.fn();
    const coordinator = withCoordinator
      ? ({ addInteractionEvent } as unknown as PlotCoordinator)
      : undefined;
    const draggingRef = { current: false };
    const hook = renderHook(() => {
      usePanning(canvasDiv, coordinator, draggingRef);
    });
    return { ...hook, canvasDiv: canvasDiv!, addInteractionEvent, draggingRef };
  }

  it("ignores moves below the threshold", () => {
    const { canvasDiv, addInteractionEvent, draggingRef } = setup();

    pointer(canvasDiv, "pointerdown", 100, 100);
    pointer(canvasDiv, "pointermove", 105, 105);
    pointer(canvasDiv, "pointerup", 105, 105);

    expect(addInteractionEvent).not.toHaveBeenCalled();
    expect(draggingRef.current).toBe(false);
  });

  it("reports panstart, panmove and panend with deltas from the pointerdown position", () => {
    vi.useFakeTimers();
    const { canvasDiv, addInteractionEvent, draggingRef } = setup();

    pointer(canvasDiv, "pointerdown", 100, 100);
    pointer(canvasDiv, "pointermove", 120, 90);
    expect(draggingRef.current).toBe(true);
    pointer(canvasDiv, "pointermove", 130, 80);
    pointer(canvasDiv, "pointerup", 140, 70);

    expect(addInteractionEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        type: "panstart",
        cancelable: false,
        deltaX: 20,
        deltaY: -10,
        center: { x: 120, y: 90 },
        boundingClientRect,
      },
      { type: "panmove", cancelable: false, deltaX: 30, deltaY: -20, boundingClientRect },
      { type: "panend", cancelable: false, deltaX: 40, deltaY: -30, boundingClientRect },
    ]);

    // Reset after the click handler had a chance to see the drag
    expect(draggingRef.current).toBe(true);
    vi.runAllTimers();
    expect(draggingRef.current).toBe(false);
    vi.useRealTimers();
  });

  it("stops listening on unmount", () => {
    const { canvasDiv, addInteractionEvent, unmount } = setup();

    unmount();
    pointer(canvasDiv, "pointerdown", 100, 100);
    pointer(canvasDiv, "pointermove", 200, 200);

    expect(addInteractionEvent).not.toHaveBeenCalled();
    expect(canvasDiv.style.touchAction).not.toBe("none");
  });

  it("does nothing without a canvas or a coordinator", () => {
    expect(() => setup({ withCanvas: false })).not.toThrow();
    const { canvasDiv, addInteractionEvent } = setup({ withCoordinator: false });
    pointer(canvasDiv, "pointerdown", 100, 100);
    pointer(canvasDiv, "pointermove", 200, 200);
    expect(addInteractionEvent).not.toHaveBeenCalled();
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Split dragging on top of dockview: two-dimensional resizing where splits meet (a T or +
 * junction), where grabbing the junction drags every split that meets there at once, and a cursor
 * that stays put for the whole drag.
 *
 * Dockview resizes each split from its own sash, which listens for `pointerdown` and then follows
 * the document's `pointermove`s. So pressing a junction just forwards that `pointerdown` to the
 * perpendicular sashes that touch it, and every split follows the same pointer.
 */

/** How close (px) the pointer must be to a perpendicular sash to grab the junction. */
const JUNCTION_RADIUS = 6;

function isSash(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && target.classList.contains("dv-sash");
}

/** A horizontal split view's sashes are vertical lines and drag along x. */
function dragsHorizontally(sash: Element): boolean {
  return sash.parentElement?.parentElement?.classList.contains("dv-horizontal") === true;
}

/** The enabled sashes across `sash` that touch the point, i.e. that form a junction with it. */
export function crossingSashes(sash: HTMLElement, x: number, y: number): HTMLElement[] {
  const root = sash.closest(".dv-shell") ?? sash.ownerDocument;
  const horizontal = dragsHorizontally(sash);
  return Array.from(root.querySelectorAll<HTMLElement>(".dv-sash.dv-enabled")).filter((other) => {
    if (dragsHorizontally(other) === horizontal) {
      return false;
    }
    const rect = other.getBoundingClientRect();
    return (
      x >= rect.left - JUNCTION_RADIUS &&
      x <= rect.right + JUNCTION_RADIUS &&
      y >= rect.top - JUNCTION_RADIUS &&
      y <= rect.bottom + JUNCTION_RADIUS
    );
  });
}

/** Class marking a sash that is being dragged as part of a junction, so it shows as active. */
export const JUNCTION_ACTIVE_CLASS = "lb-sash-junction-active";

/** Attribute set on the dockview shell while a sash is dragged; its cursor then wins everywhere. */
export const SASH_DRAG_ATTRIBUTE = "data-sash-drag";

/** Shows a move cursor while hovering a junction. Call on `pointermove`. */
export function updateJunctionCursor(event: PointerEvent): void {
  if (event.buttons !== 0 || !isSash(event.target)) {
    return;
  }
  const atJunction = crossingSashes(event.target, event.clientX, event.clientY).length > 0;
  event.target.style.cursor = atJunction ? "move" : "";
}

/** Drops a sash's junction cursor once the pointer leaves it. Call on `pointerout`. */
export function clearJunctionCursor(event: PointerEvent): void {
  if (isSash(event.target)) {
    event.target.style.removeProperty("cursor");
  }
}

/**
 * Starts a sash drag: drags the other sashes of a junction along with the pressed one, and keeps
 * the resize cursor while the pointer moves off the sash (e.g. past a panel's minimum size). Call
 * on `pointerdown` in the capture phase, before dockview's own sash handler.
 */
export function startSashDrag(event: PointerEvent): void {
  // Forwarded events are untrusted, so they don't recurse.
  if (!event.isTrusted || event.button !== 0 || !isSash(event.target)) {
    return;
  }
  const pressed = event.target;
  const others = crossingSashes(pressed, event.clientX, event.clientY);
  for (const other of others) {
    other.classList.add(JUNCTION_ACTIVE_CLASS);
    other.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        isPrimary: event.isPrimary,
        button: event.button,
        buttons: event.buttons,
      }),
    );
  }
  if (others.length > 0) {
    pressed.classList.add(JUNCTION_ACTIVE_CLASS);
  }

  const shell = pressed.closest<HTMLElement>(".dv-shell");
  shell?.style.setProperty("cursor", others.length > 0 ? "move" : getComputedStyle(pressed).cursor);
  shell?.setAttribute(SASH_DRAG_ATTRIBUTE, "");

  const doc = pressed.ownerDocument;
  const end = () => {
    for (const sash of [pressed, ...others]) {
      sash.classList.remove(JUNCTION_ACTIVE_CLASS);
      // The junction moved with the drag; the next hover recomputes the cursor.
      sash.style.removeProperty("cursor");
    }
    shell?.style.removeProperty("cursor");
    shell?.removeAttribute(SASH_DRAG_ATTRIBUTE);
    doc.removeEventListener("pointerup", end);
    doc.removeEventListener("pointercancel", end);
    doc.removeEventListener("contextmenu", end);
  };
  doc.addEventListener("pointerup", end);
  doc.addEventListener("pointercancel", end);
  doc.addEventListener("contextmenu", end);
}

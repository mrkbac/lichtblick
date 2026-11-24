// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/**
 * Drawing stops for this display frame once this much of it is used; the panels still waiting
 * draw first in the next one. A 120 Hz frame is 8.3 ms, and the rest of the app needs some of it.
 */
export const FRAME_BUDGET_MS = 4;

type Draw = () => void;

/**
 * Draws the 3D and Image panels of a window from one animation frame, spread over display frames
 * so that several panels updating on the same message don't add up to one long frame.
 */
class FrameScheduler {
  #queue = new Set<Draw>();
  #frame?: number;
  readonly #ownerWindow: Window;

  public constructor(ownerWindow: Window) {
    this.#ownerWindow = ownerWindow;
  }

  public request(draw: Draw): void {
    this.#queue.add(draw);
    this.#frame ??= this.#ownerWindow.requestAnimationFrame(this.#run);
  }

  public cancel(draw: Draw): void {
    this.#queue.delete(draw);
    if (this.#queue.size === 0 && this.#frame != undefined) {
      this.#ownerWindow.cancelAnimationFrame(this.#frame);
      this.#frame = undefined;
    }
  }

  #run = (): void => {
    this.#frame = undefined;
    const start = performance.now();
    // Draws requested while drawing (e.g. a camera clamp) wait for the next frame
    const batch = [...this.#queue];
    this.#queue.clear();
    for (const [index, draw] of batch.entries()) {
      if (index > 0 && performance.now() - start > FRAME_BUDGET_MS) {
        // Waiting panels go first next frame, so none of them starves
        this.#queue = new Set([...batch.slice(index), ...this.#queue]);
        break;
      }
      draw();
    }
    if (this.#queue.size > 0) {
      this.#frame = this.#ownerWindow.requestAnimationFrame(this.#run);
    }
  };
}

const schedulers = new WeakMap<Window, FrameScheduler>();

/** The scheduler shared by the panels of `ownerWindow` (panels can live in pop-out windows). */
export function frameSchedulerFor(ownerWindow: Window): FrameScheduler {
  let scheduler = schedulers.get(ownerWindow);
  if (!scheduler) {
    scheduler = new FrameScheduler(ownerWindow);
    schedulers.set(ownerWindow, scheduler);
  }
  return scheduler;
}

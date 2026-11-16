// SPDX-License-Identifier: MPL-2.0

export type FrameScheduler = { request: () => void; cancel: () => void };

/** Runs `callback` at most once per animation frame, however often it is requested. */
export function createFrameScheduler(callback: () => void): FrameScheduler {
  let frame: number | undefined;
  return {
    request: () => {
      frame ??= requestAnimationFrame(() => {
        frame = undefined;
        callback();
      });
    },
    cancel: () => {
      if (frame != undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
  };
}

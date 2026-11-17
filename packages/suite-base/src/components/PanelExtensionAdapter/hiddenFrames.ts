// SPDX-License-Identifier: MPL-2.0

import { Immutable, MessageEvent } from "@lichtblick/suite";

type Frame = Immutable<MessageEvent[]>;

/** A hidden panel renders at most this often; showing it renders right away. */
export const HIDDEN_RENDER_INTERVAL_MS = 1000;
// ponytail: drops the oldest frames past this, only reached when a hidden panel never renders.
const MAX_PENDING_FRAMES = 600;

/**
 * Pipeline frames a hidden panel (inactive tab, behind a maximized panel) has not rendered yet.
 *
 * A hidden panel still gets every message, so it is up to date the moment it is shown, but the
 * frames are handed to it in one batch per HIDDEN_RENDER_INTERVAL_MS instead of one render each.
 */
export class HiddenFrames {
  #pending: Frame[] = [];
  #lastSeen: Frame | undefined;
  // The batch last handed out and the pipeline frame it ended with: re-running the render with the
  // same pipeline frame must give the same array, or the render state builder sees it as new.
  #lastBatch: { source: Frame | undefined; frame: Frame } | undefined;
  #renderedAt = -Infinity;

  /** Record the pipeline frame. Frames are batched while hidden and until a batch is handed out. */
  public add(frame: Frame | undefined, { visible }: { visible: boolean }): void {
    if (frame == undefined || frame === this.#lastSeen) {
      return;
    }
    this.#lastSeen = frame;
    if (visible && this.#pending.length === 0) {
      return;
    }
    this.#pending.push(frame);
    if (this.#pending.length > MAX_PENDING_FRAMES) {
      this.#pending.shift();
    }
  }

  /** Whether a hidden panel should skip this render. */
  public shouldWait({ visible, now }: { visible: boolean; now: number }): boolean {
    return !visible && now - this.#renderedAt < HIDDEN_RENDER_INTERVAL_MS;
  }

  /** Frames waiting for a render. */
  public hasPending(): boolean {
    return this.#pending.length > 0;
  }

  /** How long until a hidden panel may render its pending frames, in ms. */
  public waitMs(now: number): number {
    return Math.max(0, this.#renderedAt + HIDDEN_RENDER_INTERVAL_MS - now);
  }

  /** The frame to render now; pending frames count as handed out. */
  public take(pipelineFrame: Frame | undefined, now: number): Frame | undefined {
    this.#renderedAt = now;
    if (this.#pending.length === 0) {
      const last = this.#lastBatch;
      if (last != undefined && pipelineFrame === last.source) {
        return last.frame;
      }
      // A newer pipeline frame: the batch is not needed any more, don't keep its messages alive.
      this.#lastBatch = undefined;
      return pipelineFrame;
    }
    const frame = this.#pending.length === 1 ? this.#pending[0]! : this.#pending.flat();
    this.#pending = [];
    this.#lastBatch = { source: pipelineFrame, frame };
    return frame;
  }

  /** Drop pending frames, e.g. after a seek. */
  public clear(): void {
    this.#pending = [];
    this.#lastBatch = undefined;
  }
}

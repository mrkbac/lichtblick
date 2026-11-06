// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** Jitter buffer: audio plays this far behind the playhead, so frames can arrive late. */
export const LATENCY_SEC = 0.2;
/** Contiguous playback may drift this far from the playhead before it is cut and re-synced. */
export const MAX_DRIFT_SEC = 0.15;
/** Never schedule closer to "now" than this; the audio thread needs time to pick it up. */
export const MIN_LEAD_SEC = 0.02;

export type ChunkPlan =
  | { kind: "drop" }
  | {
      kind: "play";
      /** AudioContext time to start at. */
      start: number;
      /** Seconds (AudioContext time) to skip at the start of the chunk because it is late. */
      skip: number;
      /** Audio already queued must be cut first: playback jumped. */
      cut: boolean;
    };

/**
 * Decides when a chunk plays, all times in AudioContext seconds.
 *
 * Chunks normally play back to back (`nextStart` is where the previous one ends) so there are no
 * gaps or clicks between messages. When that drifts too far from where the playhead says the
 * chunk belongs (`idealStart`), or the queue ran dry, playback restarts at `idealStart`.
 */
export function planChunk(args: {
  now: number;
  /** End of the previously scheduled chunk, or undefined after a reset. */
  nextStart: number | undefined;
  idealStart: number;
  /** Chunk duration in AudioContext seconds (buffer duration / playback speed). */
  duration: number;
}): ChunkPlan {
  const { now, nextStart, idealStart, duration } = args;
  const earliest = now + MIN_LEAD_SEC;

  if (
    nextStart != undefined &&
    nextStart >= earliest &&
    Math.abs(nextStart - idealStart) <= MAX_DRIFT_SEC
  ) {
    return { kind: "play", start: nextStart, skip: 0, cut: false };
  }

  if (idealStart + duration <= earliest) {
    return { kind: "drop" };
  }
  const start = Math.max(idealStart, earliest);
  return {
    kind: "play",
    start,
    skip: start - idealStart,
    cut: nextStart != undefined && nextStart > now,
  };
}

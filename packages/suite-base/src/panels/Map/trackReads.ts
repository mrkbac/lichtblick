// SPDX-License-Identifier: MPL-2.0

/** A window of the recording to read, in ns, both ends inclusive. */
export type ReadWindow = { start: bigint; end: bigint; direction: "around" | "before" | "after" };

/** The window around the playhead covers at least this much, in ns. */
const MIN_FIRST_WINDOW_NS = 20_000_000_000n;

/**
 * Non-overlapping windows covering [start, end] in the order to read them: around the playhead
 * first, so the track where the user looks shows at once, then backwards to the start and then
 * forwards to the end, each window twice the size of the one before.
 */
export function playheadWindows(start: bigint, end: bigint, playhead: bigint): ReadWindow[] {
  if (end < start) {
    return [];
  }
  const at = playhead < start ? start : playhead > end ? end : playhead;
  const duration = end - start;
  const firstSize = duration / 32n > MIN_FIRST_WINDOW_NS ? duration / 32n : MIN_FIRST_WINDOW_NS;
  const firstStart = at - firstSize / 2n < start ? start : at - firstSize / 2n;
  const firstEnd = firstStart + firstSize > end ? end : firstStart + firstSize;
  const windows: ReadWindow[] = [{ start: firstStart, end: firstEnd, direction: "around" }];
  let size = firstSize * 2n;
  for (let next = firstStart - 1n; next >= start; size *= 2n) {
    const windowStart = next - size + 1n < start ? start : next - size + 1n;
    windows.push({ start: windowStart, end: next, direction: "before" });
    next = windowStart - 1n;
  }
  size = firstSize * 2n;
  for (let next = firstEnd + 1n; next <= end; size *= 2n) {
    const windowEnd = next + size - 1n > end ? end : next + size - 1n;
    windows.push({ start: next, end: windowEnd, direction: "after" });
    next = windowEnd + 1n;
  }
  return windows;
}

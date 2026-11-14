// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

/** An offset change asked of the player, numbered so its publication can be recognized */
export type OffsetRequest = { request: number; offsets: readonly number[] };

/**
 * The offsets to ask for when `side` changes: built on the newest request the player hasn't shown
 * yet (the last of `inFlight`), else on the published offsets, so quick edits to different sides
 * don't undo each other
 */
export function nextOffsets(
  published: readonly number[],
  inFlight: readonly OffsetRequest[],
  side: number,
  change: number | ((current: number) => number),
): number[] {
  const base = inFlight.at(-1)?.offsets ?? published;
  return base.map((value, index) =>
    index !== side ? value : typeof change === "function" ? change(value) : change,
  );
}

/**
 * The requests the player hasn't published yet: those after the last one it applied
 * (`appliedRequest`, see PlayerStateActiveData.compareRequest). Other updates, such as a growing
 * source, publish the same number, so they acknowledge nothing.
 */
export function pendingRequests(
  inFlight: readonly OffsetRequest[],
  appliedRequest: number | undefined,
): OffsetRequest[] {
  return appliedRequest == undefined
    ? [...inFlight]
    : inFlight.filter(({ request }) => request > appliedRequest);
}

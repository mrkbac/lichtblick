/** @jest-environment jsdom */

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { renderHook } from "@testing-library/react";

import { acknowledge, nextOffsets, useOffsetRequests } from "./CompareSidesEditor";

describe("offset requests", () => {
  it("keeps a newer request when an older publication arrives", () => {
    // Asked for [1, 0], then [1, 1]
    let inFlight: (readonly number[])[] = [nextOffsets([0, 0], [], 0, 1)];
    inFlight = [...inFlight, nextOffsets([0, 0], inFlight, 1, 1)];
    expect(inFlight).toEqual([
      [1, 0],
      [1, 1],
    ]);

    // The player publishes the first request: the second is still on its way
    inFlight = acknowledge(inFlight, [1, 0]);
    expect(inFlight).toEqual([[1, 1]]);

    // A nudge on the first side builds on it
    expect(nextOffsets([1, 0], inFlight, 0, (current) => current + 1)).toEqual([2, 1]);

    // Once published, nothing is on its way
    expect(acknowledge(inFlight, [1, 1])).toEqual([]);
  });

  it("keeps an undo back to the published offsets until the player shows it", () => {
    // Published [0, 0]; asked for [1, 0], then undone with [0, 0]
    let inFlight: (readonly number[])[] = [[1, 0]];
    inFlight = [...inFlight, nextOffsets([0, 0], inFlight, 0, 0)];
    expect(inFlight).toEqual([
      [1, 0],
      [0, 0],
    ]);

    // The older [1, 0] is published: the undo is still on its way, so a nudge builds on it
    inFlight = acknowledge(inFlight, [1, 0]);
    expect(nextOffsets([1, 0], inFlight, 1, (current) => current + 1)).toEqual([0, 1]);
  });

  it("acknowledges skipped requests along with a later one", () => {
    expect(
      acknowledge(
        [
          [1, 0],
          [2, 0],
          [3, 0],
        ],
        [2, 0],
      ),
    ).toEqual([[3, 0]]);
    expect(acknowledge([[1, 0]], [5, 5])).toEqual([[1, 0]]);
  });

  it("acknowledges only on a publication, not on a rerender with other sides objects", () => {
    // Published [0, 0]; a nudge to 1 and back to 0 are on their way
    const first = { offsets: [0, 0] };
    const { result, rerender } = renderHook(
      ({ publication }: { publication: { offsets: number[] } }) =>
        useOffsetRequests(publication, publication.offsets),
      { initialProps: { publication: first } },
    );
    result.current.current = [
      [1, 0],
      [0, 0],
    ];

    // Something else rerenders the editor (e.g. the active side changed): same publication
    rerender({ publication: first });
    expect(result.current.current).toEqual([
      [1, 0],
      [0, 0],
    ]);

    // The player publishes [1, 0]: the undo is still on its way, and a nudge builds on it
    rerender({ publication: { offsets: [1, 0] } });
    expect(result.current.current).toEqual([[0, 0]]);
    expect(nextOffsets([1, 0], result.current.current, 1, (current) => current + 1)).toEqual([
      0, 1,
    ]);
  });
});

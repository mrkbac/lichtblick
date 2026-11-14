// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { nextOffsets, settledRequest } from "./CompareSidesEditor";

describe("offset requests", () => {
  it("keeps a newer request when an older publication arrives", () => {
    // Asked for [1, 0], then [1, 1]
    let pending = nextOffsets([0, 0], undefined, 0, 1);
    pending = nextOffsets([0, 0], pending, 1, 1);
    expect(pending).toEqual([1, 1]);

    // The player publishes the first request: the second is still on its way
    const afterFirst = settledRequest([1, 0], pending);
    expect(afterFirst).toEqual([1, 1]);

    // A nudge on the first side builds on it
    expect(nextOffsets([1, 0], afterFirst, 0, (current) => current + 1)).toEqual([2, 1]);

    // Once published, the request is done
    expect(settledRequest([1, 1], [1, 1])).toBeUndefined();
  });
});

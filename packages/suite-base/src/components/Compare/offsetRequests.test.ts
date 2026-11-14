// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { OffsetRequest, nextOffsets, pendingRequests } from "./offsetRequests";

describe("offset requests", () => {
  it("keeps a newer request when an older one is published", () => {
    // Asked for [1, 0], then [1, 1]
    const first: OffsetRequest = { request: 1, offsets: nextOffsets([0, 0], [], 0, 1) };
    const second: OffsetRequest = { request: 2, offsets: nextOffsets([0, 0], [first], 1, 1) };
    expect(second.offsets).toEqual([1, 1]);

    // The player publishes the first: the second is still on its way, and a nudge builds on it
    const inFlight = pendingRequests([first, second], 1);
    expect(inFlight).toEqual([second]);
    expect(nextOffsets([1, 0], inFlight, 0, (current) => current + 1)).toEqual([2, 1]);
    expect(pendingRequests(inFlight, 2)).toEqual([]);
  });

  it("keeps an undo on its way through updates that publish no new request", () => {
    // Published [0, 0]; asked for [1, 0], then undone with [0, 0]
    const inFlight: OffsetRequest[] = [
      { request: 1, offsets: [1, 0] },
      { request: 2, offsets: [0, 0] },
    ];
    // A growing source republishes [0, 0] without a new request: nothing is acknowledged
    expect(pendingRequests(inFlight, undefined)).toEqual(inFlight);
    // [1, 0] is published: the undo is still on its way, so a nudge builds on it
    const pending = pendingRequests(inFlight, 1);
    expect(nextOffsets([1, 0], pending, 1, (current) => current + 1)).toEqual([0, 1]);
  });

  it("acknowledges requests the player skipped along with a later one", () => {
    const inFlight: OffsetRequest[] = [
      { request: 1, offsets: [1, 0] },
      { request: 2, offsets: [2, 0] },
      { request: 3, offsets: [3, 0] },
    ];
    expect(pendingRequests(inFlight, 2)).toEqual([inFlight[2]]);
  });
});

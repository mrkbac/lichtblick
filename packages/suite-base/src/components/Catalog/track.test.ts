// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { boundsIntersect, pickTrack, trackBounds } from "./track";

describe("track helpers", () => {
  it("computes and intersects bounds", () => {
    const bounds = trackBounds([
      [11, 48],
      [12, 47],
    ]);
    expect(bounds).toEqual([11, 47, 12, 48]);
    expect(boundsIntersect(bounds!, [11.5, 47.5, 13, 49])).toBe(true);
    expect(boundsIntersect(bounds!, [12.5, 47.5, 13, 49])).toBe(false);
  });

  it("picks the chosen topic, else the first track", () => {
    const tracks = [
      { topic: "/a", points: [] },
      { topic: "/b", points: [] },
    ];
    expect(pickTrack(tracks, "/b")?.topic).toBe("/b");
    expect(pickTrack(tracks, "/missing")?.topic).toBe("/a");
    expect(pickTrack(tracks, undefined)?.topic).toBe("/a");
  });
});

// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { treeChildren } from "./WatchTree";

describe("treeChildren", () => {
  it("gives each field and element its message path", () => {
    expect(treeChildren({ x: 1, "odd name": 2 }, "/a.b").map((child) => child.path)).toEqual([
      "/a.b.x",
      '/a.b."odd name"',
    ]);
    expect(treeChildren(new Float32Array(2), "/a.@rpy").map((child) => child.path)).toEqual([
      "/a.@rpy[0]",
      "/a.@rpy[1]",
    ]);
    expect(treeChildren(new Array(500).fill(0), "/a")).toHaveLength(200);
    expect(treeChildren(3, "/a")).toEqual([]);
  });
});

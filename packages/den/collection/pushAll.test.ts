// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { pushAll } from "./pushAll";

describe("pushAll", () => {
  it("appends more items than a spread call allows", () => {
    const target = [0];
    pushAll(target, new Array<number>(300_000).fill(1));
    expect(target).toHaveLength(300_001);
  });

  it("appends an array to itself once", () => {
    const values = [1, 2];
    pushAll(values, values);
    expect(values).toEqual([1, 2, 1, 2]);
  });
});

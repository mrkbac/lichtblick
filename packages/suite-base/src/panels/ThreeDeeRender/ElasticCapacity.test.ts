// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { ElasticCapacity } from "./ElasticCapacity";

describe("ElasticCapacity", () => {
  it("keeps the capacity while large and small sizes take turns", () => {
    const capacity = new ElasticCapacity(65_536);
    expect(capacity.fit(1_000_000)).toBe(1_000_000);
    for (let i = 0; i < 1000; i++) {
      expect(capacity.fit(i % 2 === 0 ? 100_000 : 1_000_000)).toBeUndefined();
    }
  });

  it("shrinks once the size stays small, and grows with headroom", () => {
    const capacity = new ElasticCapacity(1000);
    capacity.fit(100_000);
    let shrunk: number | undefined;
    for (let i = 0; i < 30 && shrunk == undefined; i++) {
      shrunk = capacity.fit(10_000);
    }
    expect(shrunk).toBe(15_000);
    expect(capacity.fit(15_001)).toBe(22_500);
  });
});

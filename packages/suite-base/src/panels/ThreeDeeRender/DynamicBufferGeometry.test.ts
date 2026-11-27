// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import { DynamicBufferGeometry } from "./DynamicBufferGeometry";

describe("DynamicBufferGeometry", () => {
  const capacity = (geometry: DynamicBufferGeometry) => geometry.attributes.position!.count;

  it("allocates exactly first, regrows with headroom and shrinks once mostly unused", () => {
    const geometry = new DynamicBufferGeometry();
    geometry.createAttribute("position", Float32Array, 3);
    geometry.resize(100_000);
    expect(capacity(geometry)).toBe(100_000);

    geometry.resize(100_001);
    expect(capacity(geometry)).toBe(150_000);
    const grown = geometry.attributes.position;
    geometry.resize(140_000); // fits: no reallocation
    expect(geometry.attributes.position).toBe(grown);
    expect(geometry.drawRange.count).toBe(140_000);

    geometry.resize(30_000); // under a quarter
    expect(capacity(geometry)).toBe(45_000);
    geometry.resize(0); // small buffers are kept
    expect(capacity(geometry)).toBe(45_000);
  });
});

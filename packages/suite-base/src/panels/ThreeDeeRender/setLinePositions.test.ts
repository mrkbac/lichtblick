// SPDX-FileCopyrightText: Copyright (C) 2023-2026 Bayerische Motoren Werke Aktiengesellschaft (BMW AG)<lichtblick@bmwgroup.com>
// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { setLinePositions } from "./setLinePositions";

function buffer(geometry: LineSegmentsGeometry): THREE.InterleavedBuffer {
  return (geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
}

describe.each([
  ["LineGeometry", () => new LineGeometry()],
  ["LineSegmentsGeometry", () => new LineSegmentsGeometry()],
])("setLinePositions(%s)", (_name, create) => {
  it("matches setPositions() and reuses the GPU buffer while the size is unchanged", () => {
    const expected = create();
    const actual = create();
    const positions = new Float32Array([0, 0, 0, 1, 2, 3, 4, 5, 6, -1, -2, -3]);

    setLinePositions(actual, positions);
    const first = buffer(actual);
    for (let i = 0; i < 3; i++) {
      positions[4] = 10 * i;
      expected.setPositions(positions);
      setLinePositions(actual, positions);

      expect(buffer(actual)).toBe(first);
      expect(Array.from(buffer(actual).array)).toEqual(Array.from(buffer(expected).array));
      expect(actual.instanceCount).toBe(expected.instanceCount);
      expect(actual.boundingSphere).toEqual(expected.boundingSphere);
    }
    expect(first.version).toBeGreaterThan(0);

    // A size change needs a new buffer
    setLinePositions(actual, new Float32Array(positions.length + 6));
    expect(buffer(actual)).not.toBe(first);
  });
});

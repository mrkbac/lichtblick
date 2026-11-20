// SPDX-License-Identifier: MPL-2.0

import * as THREE from "three";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

import { setLineColors, setLinePositions } from "./setLinePositions";

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

describe("setLineColors", () => {
  function pairs(geometry: LineSegmentsGeometry): number[][] {
    const start = geometry.getAttribute("instanceColorStart");
    const end = geometry.getAttribute("instanceColorEnd");
    return Array.from({ length: start.count }, (_, i) => [start.getX(i), end.getX(i)]);
  }

  it("pairs strip colors like positions and reuses the buffer", () => {
    const geometry = new LineGeometry();
    const colors = new Uint8Array([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 128]);
    setLineColors(geometry, colors);
    const attribute = geometry.getAttribute(
      "instanceColorStart",
    ) as THREE.InterleavedBufferAttribute;
    expect(attribute.normalized).toBe(true);
    expect(attribute.data.stride).toBe(8);
    expect(pairs(geometry).map((p) => p.map((x) => Math.round(x * 255)))).toEqual([
      [10, 20],
      [20, 30],
    ]);

    colors[0] = 40;
    setLineColors(geometry, colors);
    expect(geometry.getAttribute("instanceColorStart")).toBe(attribute);
    expect(Math.round(pairs(geometry)[0]![0]! * 255)).toBe(40);
  });

  it("uses segment colors as they are", () => {
    const geometry = new LineSegmentsGeometry();
    setLineColors(geometry, new Float32Array([0.1, 0, 0, 1, 0.2, 0, 0, 1]));
    expect(pairs(geometry)).toEqual([[expect.closeTo(0.1), expect.closeTo(0.2)]]);
  });
});
